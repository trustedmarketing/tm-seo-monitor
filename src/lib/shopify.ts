// lib/shopify.ts — Shopify Admin API client (client-credentials grant + Admin
// GraphQL). Shopify is the revenue GROUND TRUTH (docs/CLAUDE-monitor-draft.md):
// ad platforms over-attribute (each claims the same orders), so this client
// pulls actual store orders/dollars for `conversions_daily(source='shopify')`
// to compute honest blended MER (revenue ÷ ad spend) against.
//
// Auth: a custom app gives a durable Client ID + `shpss_` client secret (NOT
// the old `shpat_` install token). Every run mints a fresh ~24h `shpat_` access
// token via the client-credentials grant — there is no long-lived token to
// store. Never logs the client secret or the minted token ("secrets never
// surface", autonomy #5).
//
// Data: paginates the Admin GraphQL `orders` connection and aggregates by
// calendar date. ShopifyQL's Admin GraphQL is deprecated — deliberately not
// used here.
import { mockApis, readFixture } from "@/lib/apiMock";

const API_VERSION = "2025-01";

export interface DailySalesRow {
  date: string;
  orders: number;
  revenue: number;
}

interface AccessTokenResponse {
  access_token?: string;
  expires_in?: number;
}

// POST /admin/oauth/access_token with the client-credentials grant. Returns
// the minted `shpat_` access token (~24h validity). Never logs `clientSecret`
// or the response body.
export async function mintToken(
  shopDomain: string,
  clientId: string,
  clientSecret: string
): Promise<string> {
  if (mockApis()) return "mock-shpat-token";

  const res = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
  });

  if (!res.ok) {
    throw new Error(`Shopify token mint failed: ${res.status} ${res.statusText}`);
  }

  const body = (await res.json()) as AccessTokenResponse;
  if (!body.access_token) {
    throw new Error("Shopify token mint failed: no access_token in response");
  }
  return body.access_token;
}

interface OrderNode {
  createdAt: string;
  currentTotalPriceSet?: { shopMoney?: { amount?: string } };
}
interface OrdersEdge {
  node: OrderNode;
}
interface OrdersConnection {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  edges: OrdersEdge[];
}
interface GraphQLOrdersResponse {
  data?: { orders?: OrdersConnection };
  errors?: { message: string }[];
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function toNumber(v: string | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// currentTotalPriceSet, NOT totalPriceSet. Shopify's own docs:
// totalPriceSet is "the total price of the order, BEFORE returns";
// currentTotalPriceSet is "the total price of the order, AFTER returns".
// Using the former counts refunded money as revenue forever — a permanent
// overcount against the store's own dashboard for any client who takes
// returns, which for an ecommerce client is all of them. It also covers most
// of the cancelled-order case without a separate filter: a cancelled order is
// normally refunded, which drops its current total to zero.
const ORDERS_QUERY = `
  query OrdersPage($cursor: String, $query: String!) {
    orders(first: 250, after: $cursor, query: $query) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          createdAt
          currentTotalPriceSet { shopMoney { amount } }
        }
      }
    }
  }
`;

// Paginates orders(first:250, after:$cursor, query:"created_at:>=SINCE
// created_at:<=UNTIL test:false") until pageInfo.hasNextPage is false,
// aggregating by calendar date (from createdAt):
// revenue = sum(currentTotalPriceSet.shopMoney.amount), orders = order count.
// Under MOCK_APIS=1, reads the already-aggregated fixture directly instead of
// hitting the network. Never logs `token`.
//
// Both the `test:false` filter and `currentTotalPriceSet` (rather than
// `totalPriceSet`) exist to make this match the number the client sees in
// their own Shopify dashboard. Note that lib/revenueReconciliation.ts CANNOT
// catch a bug in this function: it compares a fresh call to this against
// stored rows written by this, so a query-level error moves both sides
// together and reconciles clean. This function's correctness has to be
// verified against Shopify's own reporting UI, not against our own pipeline.
export async function fetchDailySales(
  shopDomain: string,
  token: string,
  days = 28
): Promise<DailySalesRow[]> {
  if (mockApis()) return readFixture<DailySalesRow[]>("shopify/daily_sales.json");

  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  // `test:false` excludes orders placed through the Bogus Gateway or a payment
  // provider in test mode. They are indistinguishable from real orders in the
  // response, so without this a round of checkout testing lands in the client's
  // reported revenue and nothing about the number looks wrong.
  const dateQuery = `created_at:>=${iso(start)} created_at:<=${iso(end)} test:false`;

  const byDate = new Map<string, { orders: number; revenue: number }>();
  let cursor: string | null = null;
  let hasNext = true;

  while (hasNext) {
    const res = await fetch(`https://${shopDomain}/admin/api/${API_VERSION}/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query: ORDERS_QUERY, variables: { cursor, query: dateQuery } }),
    });

    if (!res.ok) {
      throw new Error(`Shopify orders request failed: ${res.status} ${res.statusText}`);
    }

    const body = (await res.json()) as GraphQLOrdersResponse;
    if (body.errors?.length) {
      throw new Error(`Shopify orders GraphQL error: ${body.errors.map((e) => e.message).join("; ")}`);
    }

    const connection = body.data?.orders;
    if (!connection) break;

    for (const edge of connection.edges) {
      const date = edge.node.createdAt.slice(0, 10);
      const amount = toNumber(edge.node.currentTotalPriceSet?.shopMoney?.amount);
      const entry = byDate.get(date) ?? { orders: 0, revenue: 0 };
      entry.orders += 1;
      entry.revenue += amount;
      byDate.set(date, entry);
    }

    hasNext = connection.pageInfo.hasNextPage;
    cursor = connection.pageInfo.endCursor;
  }

  return Array.from(byDate.entries())
    .map(([date, v]) => ({ date, orders: v.orders, revenue: Math.round(v.revenue * 100) / 100 }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
