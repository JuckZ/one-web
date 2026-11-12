# OneWeb privacy and data inventory

## Cookie Manager local data

Cookie Manager is disabled by default. Its packaged background and management page handle cookie
names, values (including HttpOnly), domains, paths, attributes, accessible Store IDs and full
partition identities. Data exists only in transient memory and explicitly copied values or
downloaded plaintext JSON files; it is never persisted to extension storage. No cookie data enters
the remote-module context/capability bridge, logs, diagnostics or network requests. The existing
Firefox `authenticationInfo` transmission declaration does not cause Cookie Manager to upload cookies.

Export warns that JSON includes plaintext credentials. Import reads a local JSON file, validates
and previews it, requires an explicit destination Store and writes only selected records. Files,
records and batches are bounded; no third-party decryptors or historical format detection exist.
Background sessions last at most ten minutes and are lost on worker restart. Old visible UI data is
cleared on the next failed session operation after a worker restart; no immediate restart notification
is claimed. Close, hide, disable, revocation or expiry clears the management session. JavaScript
reference release does not guarantee physical memory erasure. Clipboard contents and downloaded
files remain under user/browser/OS control after a management session ends.

Cookie and host permissions are optional. Browser host grants are shared between modules. Ending
Cookie management clears its own authority, preserves shared browser permissions and never deletes
browser cookies. Its active-scope probe prevents other builtin permission cleanup from releasing
an overlapping grant still in use.
