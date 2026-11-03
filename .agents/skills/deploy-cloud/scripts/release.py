#!/usr/bin/env python3
"""Prepare a pinned release locally; run it on the existing Linux Docker host."""

import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import subprocess
import sys
import tarfile
import time
import urllib.request


def command(args, cwd=None, timeout=60):
    return subprocess.check_output(args, cwd=cwd, timeout=timeout).decode().strip()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def download(url):
    if not url.startswith("https://"):
        raise ValueError("下载地址必须使用 HTTPS")
    with urllib.request.urlopen(url, timeout=30) as response:
        return response.read()


def archive_files(data, strip_root=False):
    """Reject paths/links that could escape the release or include runtime data."""
    result = {}
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        for member in archive.getmembers():
            path = PurePosixPath(member.name)
            if path.is_absolute() or ".." in path.parts or member.issym() or member.islnk():
                raise ValueError(f"发布包包含不安全路径：{member.name}")
            parts = path.parts[1:] if strip_root else path.parts
            if member.isdir() or not parts:
                continue
            if not member.isfile():
                raise ValueError(f"发布包包含特殊文件：{member.name}")
            if any(p in {".env", "data", ".git", "node_modules"} for p in parts):
                raise ValueError(f"发布包包含运行数据或配置：{member.name}")
            if path.name.startswith(".env.") and not path.name.endswith((".example", ".sample")):
                raise ValueError(f"发布包包含运行环境配置：{member.name}")
            if path.suffix.lower() in {".db", ".sqlite", ".sqlite3", ".pem", ".key"}:
                raise ValueError(f"发布包包含数据库或密钥：{member.name}")
            name = str(PurePosixPath(*parts))
            if name in result:
                raise ValueError(f"发布包包含重复文件：{name}")
            result[name] = (archive.extractfile(member).read(), member.mode & 0o777)
    return result


def schema_manifest(root):
    paths = list((root / "drizzle").rglob("*")) + list((root / "src").rglob("schema.ts"))
    return {str(p.relative_to(root)): digest(p.read_bytes()) for p in paths if p.is_file()}


SCHEMA_JS = """
const fs=require('fs'),path=require('path'),crypto=require('crypto'),out={};
function walk(dir,all){for(const e of fs.readdirSync('/app/'+dir,{withFileTypes:true})){
 const p=path.posix.join(dir,e.name);
 if(e.isDirectory())walk(p,all);
 else if(all||e.name==='schema.ts')out[p]=crypto.createHash('sha256').update(fs.readFileSync('/app/'+p)).digest('hex');
}}walk('drizzle',true);walk('src',false);console.log(JSON.stringify(out));
"""


class Release:
    def __init__(self, config):
        self.config = config
        self.revision = config["revision"]
        if not re.fullmatch(r"[0-9a-f]{40}", self.revision):
            raise ValueError("版本必须是完整的 Git 提交 SHA")
        self.deploy = Path(config["deploy_dir"])
        self.directory = Path(config["release_root"]) / self.revision
        if not self.deploy.is_absolute() or not self.directory.is_absolute():
            raise ValueError("服务器目录必须使用绝对路径")
        self.url = config["base_url"].rstrip("/")
        if not re.fullmatch(r"https://[A-Za-z0-9.-]+(?::[0-9]+)?", self.url):
            raise ValueError("线上地址必须是 HTTPS 域名，不能包含路径或凭据")
        self.image = f"banji-release:{self.revision}"

    def run_command(self, args, timeout=60):
        return command(args, cwd=self.deploy, timeout=timeout)

    def compose(self, *args, timeout=60):
        return self.run_command(["docker", "compose", *args], timeout)

    def current(self):
        ids = self.compose("ps", "-q", "app").splitlines()
        if len(ids) != 1:
            raise RuntimeError("必须且只能有一个运行中的 app 实例")
        info = json.loads(self.run_command(["docker", "inspect", ids[0]]))[0]
        return ids[0], info

    def state(self, phase, **fields):
        record = {"revision": self.revision, "phase": phase, "time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), **fields}
        temporary = self.directory / "state.tmp"
        temporary.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n")
        temporary.replace(self.directory / "state.json")
        print(phase, flush=True)

    def verify(self, image_id, timeout=90):
        deadline = time.monotonic() + timeout
        while True:
            container, info = self.current()
            if info["Image"] != image_id:
                raise RuntimeError("运行镜像与待验证版本不一致")
            health = info["State"].get("Health", {}).get("Status")
            if health == "healthy":
                break
            if health == "unhealthy" or time.monotonic() >= deadline:
                raise RuntimeError("应用健康检查未通过")
            time.sleep(2)
        if json.loads(download(self.url + "/api/health")) != {"ok": True}:
            raise RuntimeError("公网健康检查未通过")
        code = self.run_command(["curl", "--max-time", "15", "-sS", "-o", "/dev/null", "-w", "%{http_code}", "-X", "POST", self.url + "/api/ops/classes.list"])
        if code != "401":
            raise RuntimeError(f"登录保护检查未通过：HTTP {code}")
        html = download(self.url + "/")
        installed = self.run_command(["docker", "exec", container, "node", "-e", "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('/app/dist/web/index.html')).digest('hex'))"])
        if digest(html) != installed:
            raise RuntimeError("公网首页与容器版本不一致")
        asset = re.search(rb'<script[^>]+src="(/assets/[^"<>]+\.js)"', html)
        if not asset or not download(self.url + asset.group(1).decode()):
            raise RuntimeError("前端入口资源不可用")

    def execute(self):
        # Linux only. The deployment lock is shared by every revision.
        import fcntl

        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        with (self.directory.parent / "deploy.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self._execute()

    def _execute(self):
        switched = False
        new_id = None
        try:
            self.state("PREFLIGHT")
            container, previous = self.current()
            previous_id = previous["Image"]
            if previous["Config"].get("Labels", {}).get("org.opencontainers.image.revision") == self.revision:
                self.verify(previous_id)
                self.state("COMPLETE", already_current=True)
                return
            config_hash = digest(self.compose("config").encode())
            archive = self.directory / "source.tar.gz"
            if not archive.exists():
                self.state("DOWNLOADING")
                data = download(self.config["archive_url"])
                if digest(data) != self.config["archive_sha256"]:
                    raise RuntimeError("下载的发布包校验失败")
                archive.write_bytes(data)
            data = archive.read_bytes()
            if digest(data) != self.config["archive_sha256"]:
                raise RuntimeError("发布包校验失败，请核对上传文件")
            files = archive_files(data, strip_root=True)
            source = self.directory / "source"
            source.mkdir(exist_ok=True)
            # A retry of this exact revision may reuse its verified source only.
            existing = {str(p.relative_to(source)) for p in source.rglob("*") if p.is_file()}
            if existing - files.keys():
                raise RuntimeError("构建目录存在发布包之外的文件，请人工检查")
            for name, (body, mode) in files.items():
                target = source / name
                if not target.resolve().is_relative_to(source.resolve()):
                    raise RuntimeError("构建目录中的链接指向发布目录之外")
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(body)
                target.chmod(mode)
            current_schema = json.loads(self.run_command(["docker", "exec", container, "node", "-e", SCHEMA_JS]))
            if schema_manifest(source) != current_schema:
                raise RuntimeError("数据库结构或迁移文件有变化：转 db-change 流程，不能走自动回退发布")
            self.state("BUILDING")
            build = ["docker", "build", "--label", f"org.opencontainers.image.revision={self.revision}", "-t", self.image]
            for key, value in self.config.get("build_args", {}).items():
                if key not in {"DEBIAN_MIRROR", "NPM_REGISTRY"}:
                    raise ValueError(f"未支持的构建参数：{key}")
                build.extend(["--build-arg", f"{key}={value}"])
            subprocess.run([*build, str(source)], check=True, timeout=1200)
            new_id = self.run_command(["docker", "image", "inspect", "--format", "{{.Id}}", self.image])
            if self.current()[1]["Image"] != previous_id or digest(self.compose("config").encode()) != config_hash:
                raise RuntimeError("构建期间线上版本或配置发生变化，停止切换")
            self.state("BACKING_UP")
            backup = self.compose("exec", "-T", "app", "banji", "backup")
            print(backup, flush=True)
            # Use the existing Compose image name, preserving its overrides and proxy.
            runtime_image = previous["Config"]["Image"]
            rollback_image = f"banji-rollback:{self.revision}"
            self.run_command(["docker", "tag", previous_id, rollback_image])
            (self.directory / "previous.json").write_text(json.dumps({"image_id": previous_id, "image_name": runtime_image, "backup": backup}, ensure_ascii=False, indent=2))
            self.run_command(["docker", "tag", new_id, runtime_image])
            switched = True
            self.state("SWITCHING")
            self.compose("up", "-d", "--no-deps", "--no-build", "--pull", "never", "app", timeout=120)
            self.state("VERIFYING")
            self.verify(new_id)
            if digest(self.compose("config").encode()) != config_hash:
                raise RuntimeError("发布期间部署配置发生变化")
            self.state("COMPLETE", image_id=new_id, previous_image=rollback_image, backup=backup)
        except Exception as error:
            if switched:
                try:
                    if digest(self.compose("config").encode()) != config_hash:
                        raise RuntimeError("部署配置已被其他操作改变，未自动回退")
                    # A concurrent operator's different image must not be overwritten.
                    ids = self.compose("ps", "-a", "-q", "app").splitlines()
                    if len(ids) > 1:
                        raise RuntimeError("出现多个 app 实例，停止自动回退")
                    if len(ids) == 1:
                        info = json.loads(self.run_command(["docker", "inspect", ids[0]]))[0]
                        if info["Image"] not in {new_id, previous_id}:
                            raise RuntimeError("线上镜像已被其他操作改变，未执行回退")
                    self.run_command(["docker", "tag", previous_id, runtime_image])
                    self.compose("up", "-d", "--no-deps", "--no-build", "--pull", "never", "app", timeout=120)
                    self.verify(previous_id)
                    self.state("ROLLED_BACK", error=str(error))
                except Exception as rollback_error:
                    self.state("ROLLBACK_FAILED", error=str(error), rollback_error=str(rollback_error))
            else:
                self.state("FAILED", error=str(error))
            raise


def prepare(args):
    root = Path(command(["git", "rev-parse", "--show-toplevel"]))
    if command(["git", "status", "--porcelain"], cwd=root):
        raise RuntimeError("工作区有未提交改动，请先整理并提交本次发布内容")
    revision = command(["git", "rev-parse", f"{args.revision}^{{commit}}"], cwd=root)
    origin = command(["git", "remote", "get-url", "origin"], cwd=root)
    match = re.fullmatch(r"(?:https://github.com/|git@github.com:)([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+?)(?:\.git)?", origin)
    if not match:
        raise ValueError("当前发布包流程适用于 GitHub 仓库")
    archive_url = f"https://codeload.github.com/{match.group(1)}/tar.gz/{revision}"
    data = download(archive_url)
    published = archive_files(data, strip_root=True)
    committed = archive_files(subprocess.check_output(["git", "archive", revision], cwd=root))
    if published != committed:
        raise RuntimeError("下载的代码与本地提交不一致，未生成发布任务")
    profile = json.loads(Path(args.profile).expanduser().read_text())
    config = {key: profile[key] for key in ["deploy_dir", "release_root", "base_url", "build_args"]}
    config.update(revision=revision, archive_url=archive_url, archive_sha256=digest(data))
    release = Release(config)
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    (output / "source.tar.gz").write_bytes(data)
    (output / "request.json").write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n")
    runner = base64.b64encode(Path(__file__).read_bytes()).decode()
    request = base64.b64encode(json.dumps(config).encode()).decode()
    destination = shlex.quote(str(release.directory))
    launch = f"""#!/bin/sh
set -eu
umask 077
mkdir -p {destination}
cd {destination}
printf '%s' '{runner}' | base64 -d > runner.py
printf '%s' '{request}' | base64 -d > request.json
nohup python3 runner.py run request.json >> release.log 2>&1 < /dev/null &
echo RELEASE_PID=$!
echo STATUS_FILE={destination}/state.json
"""
    (output / "launch.sh").write_text(launch)
    (output / "status.sh").write_text(f"#!/bin/sh\nset -eu\ncd {destination}\nif test -f state.json; then cat state.json; fi\ntail -n 16 release.log\n")
    # Optional fallback when neither SSH transfer nor server-side GitHub download works.
    chunks = [data[i:i + 24000] for i in range(0, len(data), 24000)]
    for index, chunk in enumerate(chunks):
        encoded = base64.b64encode(chunk).decode()
        (output / f"upload-{index + 1:03}.sh").write_text(f"#!/bin/sh\nset -eu\numask 077\nmkdir -p {destination}\nprintf '%s' '{encoded}' | base64 -d > {destination}/archive-part-{index:03}\n")
    parts = " ".join(f"archive-part-{i:03}" for i in range(len(chunks)))
    (output / "upload-finish.sh").write_text(f"#!/bin/sh\nset -eu\ncd {destination}\ncat {parts} > source-upload.tmp\necho '{digest(data)}  source-upload.tmp' | sha256sum -c -\nmv source-upload.tmp source.tar.gz\n")
    print(json.dumps({"revision": revision, "output": str(output), "launch_bytes": len(launch.encode()), "archive_sha256": digest(data)}, ensure_ascii=False, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="action", required=True)
    local = commands.add_parser("prepare", help="校验已推送的提交，生成发布命令和断网上传备用包")
    local.add_argument("--revision", default="HEAD")
    local.add_argument("--profile", default="~/.config/banji/deploy.json")
    local.add_argument("--output", required=True)
    remote = commands.add_parser("run", help="服务器执行；由生成的 launch.sh 后台调用")
    remote.add_argument("config")
    args = parser.parse_args()
    if args.action == "prepare":
        prepare(args)
    else:
        Release(json.loads(Path(args.config).read_text())).execute()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"发布停止：{error}", file=sys.stderr)
        sys.exit(1)
