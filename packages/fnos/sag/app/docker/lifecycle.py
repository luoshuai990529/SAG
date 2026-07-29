#!/usr/bin/env python3

import os
from pathlib import Path, PurePosixPath
import shutil
import sys
import tarfile


DATA_ROOT = Path(os.environ.get("SAG_DATA_ROOT", "/data"))
BACKUP_ROOT = Path(os.environ.get("SAG_BACKUP_ROOT", "/backup"))


def data_size_kib() -> None:
    total = 0
    for root, _directories, files in os.walk(DATA_ROOT):
        for name in files:
            try:
                total += os.lstat(Path(root, name)).st_size
            except FileNotFoundError:
                pass
    print((total + 1023) // 1024)


def create_backup() -> None:
    requested = PurePosixPath(os.environ["SAG_ARCHIVE_TEMP"])
    if requested.parent != PurePosixPath("/backup") or requested.name in {"", ".", ".."}:
        raise ValueError("SAG_ARCHIVE_TEMP must name one file directly under /backup")
    target = BACKUP_ROOT / requested.name
    with tarfile.open(target, "x:gz") as archive:
        archive.add(DATA_ROOT, arcname="data", recursive=True)
    target.chmod(0o600)


def delete_data_contents() -> None:
    for entry in os.scandir(DATA_ROOT):
        if entry.is_dir(follow_symlinks=False):
            shutil.rmtree(entry.path)
        else:
            os.unlink(entry.path)


def main() -> int:
    os.umask(0o077)
    action = os.environ.get("SAG_LIFECYCLE_ACTION")
    actions = {
        "size": data_size_kib,
        "backup": create_backup,
        "delete": delete_data_contents,
    }
    if action not in actions:
        print("unsupported SAG_LIFECYCLE_ACTION", file=sys.stderr)
        return 2
    actions[action]()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
