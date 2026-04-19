import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  createKnotSession,
  findMerchantByName,
  getKnotPublicConfig,
  getKnotRuntimeConfigStatus,
} from "../knot.server";

const log = (msg: string, extra?: unknown) => {
  if (extra !== undefined) {
    console.log(`[knot/session] ${msg}`, extra);
  } else {
    console.log(`[knot/session] ${msg}`);
  }
};

export const loader = async () => new Response(null, { status: 405 });

export const action = async ({ request }: ActionFunctionArgs) => {
  log(`>>> ${request.method} ${request.url}`);
  log("headers", Object.fromEntries(request.headers.entries()));

  if (request.method !== "POST") {
    return new Response(null, { status: 405 });
  }

  try {
    const proxyAuth = await authenticate.public.appProxy(request);
    log("appProxy auth OK", { shop: proxyAuth?.session?.shop, hasAdmin: Boolean(proxyAuth?.admin) });
  } catch (error) {
    log("appProxy auth FAILED", error instanceof Error ? { message: error.message, stack: error.stack } : error);
    if (error instanceof Response) {
      const bodyText = await error.clone().text().catch(() => "");
      log("appProxy auth response body", bodyText.slice(0, 500));
      return Response.json(
        {
          error: "App proxy authentication failed.",
          details: `Status ${error.status}${error.statusText ? ` (${error.statusText})` : ""}. Ensure app proxy is configured and app is installed on this store.`,
          authBody: bodyText.slice(0, 500),
        },
        { status: error.status || 401 },
      );
    }

    return Response.json(
      {
        error: "App proxy authentication failed.",
        details: error instanceof Error ? error.message : "Unknown app proxy error",
      },
      { status: 500 },
    );
  }

  try {
    const knotRuntime = getKnotRuntimeConfigStatus();
    log("knot runtime", knotRuntime);
    if (!knotRuntime.hasClientId || !knotRuntime.hasSecret) {
      log("MISSING creds — aborting");
      return Response.json(
        {
          error: "Knot credentials are missing on server.",
          details:
            "Set KNOT_CLIENT_ID and KNOT_SECRET in your app environment, then restart the dev server.",
          runtime: knotRuntime,
        },
        { status: 500 },
      );
    }

    const body = (await request.json()) as {
      externalUserId?: string;
      email?: string;
      phoneNumber?: string;
      shopDomain?: string;
      returnUrl?: string;
    };
    log("request body", body);

    const shopDomain = body.shopDomain || "storefront";
    const externalUserId =
      body.externalUserId ||
      `${shopDomain}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    log("calling createKnotSession", { externalUserId, shopDomain });

    const sessionId = await createKnotSession({
      externalUserId,
      email: body.email || null,
      phoneNumber: body.phoneNumber || null,
      metadata: {
        source: "amazon_store_popup",
        shop_domain: shopDomain,
      },
    });
    log("knot session created", { sessionId });

    log("calling findMerchantByName(Amazon)");
    const amazonMerchant = await findMerchantByName("Amazon");
    log("merchant result", amazonMerchant);

    const knot = getKnotPublicConfig();
    if (!knot.clientId) {
      throw new Error("KNOT_CLIENT_ID is missing on the server.");
    }

    const responseBody = {
      sessionId,
      externalUserId,
      merchantIds: amazonMerchant ? [amazonMerchant.id] : undefined,
      merchantName: amazonMerchant?.name || "Amazon",
      clientId: knot.clientId,
      environment: knot.environment,
      runtime: knotRuntime,
      returnUrl: body.returnUrl || null,
    };
    log("<<< 200 response", responseBody);
    return Response.json(responseBody);
  } catch (error) {
    log("EXCEPTION", error instanceof Error ? { message: error.message, stack: error.stack } : error);
    return Response.json(
      {
        error: "Failed to create Knot session.",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 400 },
    );
  }
};
