#!/usr/bin/env python3

import os
from pathlib import Path, PurePosixPath
import shutil
import sqlite3
import stat
import sys
import tarfile


DATA_ROOT = Path(os.environ.get("SAG_DATA_ROOT", "/data"))
BACKUP_ROOT = Path(os.environ.get("SAG_BACKUP_ROOT", "/backup"))
CONFIG_ROOT = Path(os.environ.get("SAG_CONFIG_ROOT", "/config"))


def data_size_kib() -> None:
    total = 0
    for root, directories, files in os.walk(DATA_ROOT, followlinks=False):
        root_stat = os.lstat(root)
        total += max(root_stat.st_size, root_stat.st_blocks * 512)
        for name in directories:
            path = Path(root, name)
            if path.is_symlink():
                item_stat = os.lstat(path)
                total += max(item_stat.st_size, item_stat.st_blocks * 512)
        for name in files:
            try:
                item_stat = os.lstat(Path(root, name))
                total += max(item_stat.st_size, item_stat.st_blocks * 512)
            except FileNotFoundError:
                pass
    print((total + 1023) // 1024)


def create_backup() -> None:
    requested = PurePosixPath(os.environ["SAG_ARCHIVE_TEMP"])
    if requested.parent != PurePosixPath("/backup") or requested.name in {"", ".", ".."}:
        raise ValueError("SAG_ARCHIVE_TEMP must name one file directly under /backup")
    target = BACKUP_ROOT / requested.name
    reserved = False
    try:
        descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        os.close(descriptor)
        reserved = True
        with tarfile.open(target, "w:gz") as archive:
            archive.dereference = False
            archive.add(DATA_ROOT, arcname="data", recursive=True)
        target.chmod(0o600)
    except BaseException:
        if reserved:
            target.unlink(missing_ok=True)
        raise


def delete_data_contents() -> None:
    for entry in os.scandir(DATA_ROOT):
        if entry.is_dir(follow_symlinks=False):
            shutil.rmtree(entry.path)
        else:
            os.unlink(entry.path)


def reset_password_auth() -> None:
    database = DATA_ROOT / "sag.db"
    if not database.is_file() or database.is_symlink():
        raise RuntimeError("SAG auth reset requires an existing regular /data/sag.db")

    connection = sqlite3.connect(database, timeout=30)
    try:
        connection.execute("BEGIN IMMEDIATE")
        table = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'"
        ).fetchone()
        if table is None:
            raise RuntimeError("SAG auth reset requires an initialized users table")
        columns = {
            row[1] for row in connection.execute("PRAGMA table_info(users)").fetchall()
        }
        required = {"password_initialized", "auth_version"}
        if not required.issubset(columns):
            raise RuntimeError("SAG auth reset requires the current auth schema")
        user_ids = connection.execute("SELECT id FROM users LIMIT 2").fetchall()
        if len(user_ids) > 1:
            raise RuntimeError(
                "SAG auth reset requires exactly one password user; database is ambiguous"
            )
        if user_ids:
            connection.execute(
                """
                UPDATE users
                SET password_initialized = 0,
                    auth_version = auth_version + 1
                WHERE id = ?
                """,
                (user_ids[0][0],),
            )
        connection.commit()
    except BaseException:
        connection.rollback()
        raise
    finally:
        connection.close()


def fsync_auth_env() -> None:
    secret_file = CONFIG_ROOT / "sag.env"
    flags = os.O_RDWR | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(secret_file, flags)
    try:
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise RuntimeError("/config/sag.env must be a regular file")
        os.fsync(descriptor)
    finally:
        os.close(descriptor)

    directory_flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
    directory_descriptor = os.open(CONFIG_ROOT, directory_flags)
    try:
        if not stat.S_ISDIR(os.fstat(directory_descriptor).st_mode):
            raise RuntimeError("/config must be a directory")
        os.fsync(directory_descriptor)
    finally:
        os.close(directory_descriptor)


def main() -> int:
    os.umask(0o077)
    action = os.environ.get("SAG_LIFECYCLE_ACTION")
    actions = {
        "size": data_size_kib,
        "backup": create_backup,
        "delete": delete_data_contents,
        "auth-reset": reset_password_auth,
        "auth-fsync": fsync_auth_env,
    }
    if action not in actions:
        print("unsupported SAG_LIFECYCLE_ACTION", file=sys.stderr)
        return 2
    actions[action]()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
