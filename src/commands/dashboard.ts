import { readConfigFileSnapshot, resolveGatewayPort } from "../config/config.js";
import { normalizeControlUiBasePath } from "../gateway/control-ui-shared.js";
import { copyToClipboard } from "../infra/clipboard.js";
import type { RuntimeEnv } from "../runtime.js";
import { defaultRuntime } from "../runtime.js";
import {
  detectBrowserOpenSupport,
  formatControlUiSshHint,
  openUrl,
  resolveControlUiLinks,
} from "./onboard-helpers.js";

type DashboardOptions = {
  noOpen?: boolean;
};

export async function dashboardCommand(
  runtime: RuntimeEnv = defaultRuntime,
  options: DashboardOptions = {},
) {
  const snapshot = await readConfigFileSnapshot();
  const cfg = snapshot.valid ? snapshot.config : {};
  const port = resolveGatewayPort(cfg);
  const bind = cfg.gateway?.bind ?? "loopback";
  const basePath = cfg.gateway?.controlUi?.basePath;
  const customBindHost = cfg.gateway?.customBindHost;
  const preferredUrl = cfg.gateway?.controlUi?.preferredUrl?.trim();
  const token = cfg.gateway?.auth?.token ?? process.env.OPENCLAW_GATEWAY_TOKEN ?? "";

  // Use preferred URL when set (e.g. Tailscale HTTPS for Docker setups).
  const links = preferredUrl
    ? (() => {
        const base = preferredUrl.replace(/\/+$/, "");
        const path = normalizeControlUiBasePath(basePath);
        const uiPath = path ? `/${path}/` : "/";
        return { httpUrl: `${base}${uiPath}`, wsUrl: "" };
      })()
    : resolveControlUiLinks({
        port,
        bind: bind === "lan" ? "loopback" : bind,
        customBindHost,
        basePath,
      });
  // Prefer URL fragment to avoid leaking auth tokens via query params.
  const dashboardUrl = token
    ? `${links.httpUrl}#token=${encodeURIComponent(token)}`
    : links.httpUrl;

  runtime.log(`Dashboard URL: ${dashboardUrl}`);

  const copied = await copyToClipboard(dashboardUrl).catch(() => false);
  runtime.log(copied ? "Copied to clipboard." : "Copy to clipboard unavailable.");

  let opened = false;
  let hint: string | undefined;
  if (!options.noOpen) {
    const browserSupport = await detectBrowserOpenSupport();
    if (browserSupport.ok) {
      opened = await openUrl(dashboardUrl);
    }
    if (!opened) {
      hint = formatControlUiSshHint({
        port,
        basePath,
        token: token || undefined,
      });
    }
  } else {
    hint = "Browser launch disabled (--no-open). Use the URL above.";
  }

  if (opened) {
    runtime.log("Opened in your browser. Keep that tab to control OpenClaw.");
  } else if (hint) {
    runtime.log(hint);
  }
}
