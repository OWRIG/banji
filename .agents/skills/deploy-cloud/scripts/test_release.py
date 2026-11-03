"""Local release rehearsals. All Docker/network actions are replaced; no server is used."""

import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("release", Path(__file__).with_name("release.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
REVISION = "a" * 40
HTML = b'<script type="module" src="/assets/index-current.js"></script>'


def archive(files, prefix="repo/", link=None):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as package:
        for name, body in files.items():
            member = tarfile.TarInfo(prefix + name)
            member.size = len(body)
            member.mode = 0o644
            package.addfile(member, io.BytesIO(body))
        if link:
            member = tarfile.TarInfo(prefix + "escape")
            member.type = tarfile.SYMTYPE
            member.linkname = link
            package.addfile(member)
    return output.getvalue()


class FakeRelease(release.Release):
    def __init__(self, config, source_files):
        super().__init__(config)
        self.active = "old-image"
        self.tags = {"deploy-app": "old-image"}
        self.events = []
        self.source_files = source_files
        self.bad_health = False
        self.bad_auth = False
        self.change_config = False
        self.config_version = "original config"
        self.already = False

    def info(self):
        label = REVISION if self.active == "new-image" or self.already else "b" * 40
        return {"Image": self.active, "Config": {"Image": "deploy-app", "Labels": {"org.opencontainers.image.revision": label}}, "State": {"Health": {"Status": "unhealthy" if self.bad_health and self.active == "new-image" else "healthy"}}}

    def run_command(self, args, timeout=60):
        self.events.append(args)
        if args[:3] == ["docker", "compose", "ps"]:
            return "app-container"
        if args[:2] == ["docker", "inspect"]:
            return json.dumps([self.info()])
        if args[:3] == ["docker", "compose", "config"]:
            return self.config_version
        if args[:3] == ["docker", "compose", "exec"]:
            return "已备份到 /app/data/backups/test-manual.db"
        if args[:3] == ["docker", "compose", "up"]:
            self.active = self.tags["deploy-app"]
            return "started"
        if args[:3] == ["docker", "image", "inspect"]:
            return "new-image"
        if args[:2] == ["docker", "tag"]:
            self.tags[args[3]] = args[2]
            return ""
        if args[:2] == ["docker", "exec"] and args[-1] == release.SCHEMA_JS:
            return json.dumps({name: release.digest(body) for name, body in self.source_files.items() if name.startswith("drizzle/") or name.endswith("schema.ts")})
        if args[:2] == ["docker", "exec"]:
            return release.digest(HTML)
        if args[0] == "curl":
            return "200" if self.bad_auth and self.active == "new-image" else "401"
        raise AssertionError(f"Unexpected command: {args}")


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name)
        deploy = root / "app" / "deploy"
        deploy.mkdir(parents=True)
        (deploy / ".env").write_text("fixture-secret-stays-on-server")
        (deploy / "data").mkdir()
        (deploy / "data" / "app.db").write_bytes(b"fixture student database")
        self.files = {"Dockerfile": b"FROM node:22-slim", "drizzle/0001.sql": b"CREATE TABLE example (id INTEGER);", "src/server/db/schema.ts": b"schema"}
        self.data = archive(self.files)
        self.config = {"revision": REVISION, "deploy_dir": str(deploy), "release_root": str(root / "releases"), "base_url": "https://example.test", "archive_url": "https://example.test/source.tgz", "archive_sha256": release.digest(self.data), "build_args": {}}
        self.runner = FakeRelease(self.config, self.files)

    def download(self, url):
        if url.endswith("source.tgz"):
            return self.data
        if url.endswith("api/health"):
            return b'{"ok":true}'
        if url.endswith(".js"):
            return b"new frontend bundle"
        return HTML

    def run_release(self, build_error=False):
        def build(args, **kwargs):
            self.runner.events.append(args)
            if build_error:
                raise subprocess.CalledProcessError(1, args)
            if self.runner.change_config:
                self.runner.config_version = "changed by another operator"
        with patch.object(release, "download", side_effect=self.download), patch.object(release.subprocess, "run", side_effect=build):
            self.runner.execute()

    def phase(self):
        return json.loads((self.runner.directory / "state.json").read_text())["phase"]

    def test_success_backs_up_before_switch_and_keeps_data(self):
        self.run_release()
        self.assertEqual(self.phase(), "COMPLETE")
        self.assertEqual(self.runner.active, "new-image")
        backup = next(i for i, a in enumerate(self.runner.events) if a[:3] == ["docker", "compose", "exec"])
        switch = next(i for i, a in enumerate(self.runner.events) if a[:3] == ["docker", "compose", "up"])
        self.assertLess(backup, switch)
        self.assertEqual((self.runner.deploy / "data/app.db").read_bytes(), b"fixture student database")
        self.assertEqual((self.runner.deploy / ".env").read_text(), "fixture-secret-stays-on-server")
        self.assertTrue(all(a[-1] == "app" and "--no-deps" in a for a in self.runner.events if a[:3] == ["docker", "compose", "up"]))

    def test_build_failure_leaves_current_service_running(self):
        with self.assertRaises(subprocess.CalledProcessError):
            self.run_release(build_error=True)
        self.assertEqual(self.phase(), "FAILED")
        self.assertEqual(self.runner.active, "old-image")
        self.assertFalse(any(a[:3] == ["docker", "compose", "up"] for a in self.runner.events))

    def test_failed_health_rolls_back_and_verifies_previous_image(self):
        self.runner.bad_health = True
        with self.assertRaisesRegex(RuntimeError, "健康检查"):
            self.run_release()
        self.assertEqual(self.phase(), "ROLLED_BACK")
        self.assertEqual(self.runner.active, "old-image")

    def test_failed_authentication_guard_rolls_back(self):
        self.runner.bad_auth = True
        with self.assertRaisesRegex(RuntimeError, "登录保护"):
            self.run_release()
        self.assertEqual(self.phase(), "ROLLED_BACK")

    def test_schema_change_stops_before_build_and_backup(self):
        self.data = archive({**self.files, "drizzle/0002.sql": b"ALTER TABLE example ADD COLUMN x;"})
        self.runner.config["archive_sha256"] = release.digest(self.data)
        with self.assertRaisesRegex(RuntimeError, "db-change"):
            self.run_release()
        self.assertFalse(any(a[:2] == ["docker", "build"] or a[:3] == ["docker", "compose", "exec"] for a in self.runner.events))

    def test_archive_mismatch_never_touches_running_service(self):
        self.runner.config["archive_sha256"] = "0" * 64
        with self.assertRaisesRegex(RuntimeError, "校验失败"):
            self.run_release()
        self.assertEqual(self.runner.active, "old-image")

    def test_configuration_changed_during_build_stops_before_switch(self):
        self.runner.change_config = True
        with self.assertRaisesRegex(RuntimeError, "配置发生变化"):
            self.run_release()
        self.assertEqual(self.runner.active, "old-image")

    def test_same_revision_verifies_without_build_or_restart(self):
        self.runner.already = True
        self.run_release()
        self.assertEqual(self.phase(), "COMPLETE")
        self.assertFalse(any(a[:2] == ["docker", "build"] or a[:3] == ["docker", "compose", "up"] for a in self.runner.events))

    def test_stale_frontend_rolls_back_instead_of_reporting_success(self):
        original = self.download
        def stale(url):
            if url.endswith("/") and self.runner.active == "new-image":
                return b"old frontend page"
            return original(url)
        self.download = stale
        with self.assertRaisesRegex(RuntimeError, "公网首页"):
            self.run_release()
        self.assertEqual(self.phase(), "ROLLED_BACK")
        self.assertEqual(self.runner.active, "old-image")

    def test_archive_refuses_paths_links_and_runtime_data(self):
        for name in ["../escape", "/absolute", "deploy/.env", ".env.production", "deploy/data/app.db", "credentials.pem"]:
            with self.subTest(name=name), self.assertRaises(ValueError):
                release.archive_files(archive({name: b"never deploy"}, prefix=""))
        with self.assertRaises(ValueError):
            release.archive_files(archive({}, link="/etc"), strip_root=True)


if __name__ == "__main__":
    unittest.main()
