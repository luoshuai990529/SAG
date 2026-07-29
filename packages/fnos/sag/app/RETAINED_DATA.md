# Retained-data fallback

The uninstall wizard defaults to retaining `${TRIM_PKGVAR}/data`. Final fnOS
cleanup behavior for application-private runtime directories still requires
verification on the target x86 device.

Until that device gate is complete, use this deterministic fallback before
uninstalling:

1. Stop SAG from App Center so the backup is cold.
2. Copy the newest full archive from `${TRIM_PKGVAR}/backup/` to a user-created
   shared folder outside the application package tree.
3. Verify the copied archive with `tar -tzf <archive>` and record its SHA-256.
4. Leave **Retain data** selected in the uninstall wizard.
5. Do not delete the external archive until SAG has been reinstalled and its
   complete `/data` tree has been restored and verified.

Selecting **Permanently delete active data** is the only path that authorizes
`cmd/uninstall_callback` to remove `${TRIM_PKGVAR}/data`.
