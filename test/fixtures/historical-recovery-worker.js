import { install, uninstall } from "../../lib/install.js";
import { __setTransactionTestHooks } from "../../lib/transaction.js";

const [operation, root, boundary] = process.argv.slice(2);
if (operation !== undefined) {
  const hook = boundary === "all-preimage"
    ? "afterAuthorityBundleReplication"
    : "afterCleanupAcknowledgementDeletion";
  __setTransactionTestHooks({
    [hook]: async () => process.exit(boundary === "all-preimage" ? 81 : 82)
  });

  if (operation === "install") await install({ scope: "project", cwd: root });
  else if (operation === "uninstall") await uninstall({ cwd: root });
  else throw new Error(`unknown operation: ${operation}`);
}
