#!/usr/bin/env python3
"""Build project-import ZIPs from a reviewed Git commit."""
import argparse
from io import BytesIO
from pathlib import Path
import subprocess
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
PACKAGES = {
    "codex": ("", ".agents/skills/claude-code-bridge"),
    "claude": (".claude/", ".claude/skills/codex-app-bridge"),
}


def git(*args):
    return subprocess.check_output(["git", "-C", str(ROOT), *args])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ref", nargs="?", default="HEAD")
    args = parser.parse_args()
    commit = git("rev-parse", "--verify", "--end-of-options", f"{args.ref}^{{commit}}").decode().strip()
    license_text = git("show", f"{commit}:LICENSE")
    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)
    for host, (prefix, skill) in PACKAGES.items():
        contents = git("archive", "--format=zip", f"{commit}:{host}")
        with ZipFile(BytesIO(contents)) as source:
            files = [entry for entry in source.infolist() if not entry.is_dir()]
            names = {prefix + entry.filename for entry in files}
            if f"{skill}/SKILL.md" not in names or any(not name.startswith(f"{skill}/") for name in names):
                raise ValueError(f"{host} archive must contain exactly its project skill directory")
            output = dist / f"{host}-skill.zip"
            with ZipFile(output, "w", ZIP_DEFLATED) as target:
                for entry in files:
                    data = source.read(entry)
                    entry.filename = prefix + entry.filename
                    target.writestr(entry, data)
                target.writestr(f"{skill}/LICENSE", license_text)
        print(output.relative_to(ROOT))


if __name__ == "__main__":
    main()
