import { getEnv } from '../../env';

export type MetaLeadPayload = {
  id: string;
  created_time?: string;
  ad_id?: string;
  form_id?: string;
  field_data?: { name: string; values: string[] }[];
};

export type MetaAttribution = {
  pageId: string;
  formId?: string;
  adId?: string;
  adName?: string;
  adsetId?: string;
  adsetName?: string;
  campaignId?: string;
  campaignName?: string;
};

function graphUrl(path: string, accessToken: string, fields?: string) {
  const env = getEnv();
  const url = new URL(`https://graph.facebook.com/${env.META_GRAPH_VERSION}/${path}`);
  if (fields) url.searchParams.set('fields', fields);
  url.searchParams.set('access_token', accessToken);
  return url;
}

async function graphGet<T>(url: URL): Promise<T> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(12_000),
    cache: 'no-store',
  });
  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: { message?: string; code?: number } })
    | null;
  if (!response.ok || !payload || payload.error) {
    throw new Error(payload?.error?.message ?? `Meta Graph request failed (${response.status})`);
  }
  return payload;
}

export async function fetchMetaLead(leadgenId: string, accessToken: string) {
  return graphGet<MetaLeadPayload>(
    graphUrl(leadgenId, accessToken, 'id,created_time,ad_id,form_id,field_data'),
  );
}

export async function verifyMetaPage(pageId: string, accessToken: string, verifyToken: string) {
  const page = await graphGet<{ id: string; name?: string }>(
    graphUrl(pageId, accessToken, 'id,name'),
  );
  if (page.id !== pageId) throw new Error('Meta page verification returned a different page');
  const form = new URL(
    `https://graph.facebook.com/${getEnv().META_GRAPH_VERSION}/${pageId}/leadgen_forms`,
  );
  form.searchParams.set('access_token', accessToken);
  form.searchParams.set('limit', '1');
  await graphGet(form);
  if (verifyToken.length < 12) throw new Error('The verification token must be at least 12 characters');
  return page;
}

export async function fetchMetaAttribution(
  lead: MetaLeadPayload,
  pageId: string,
  accessToken: string,
): Promise<MetaAttribution> {
  const attribution: MetaAttribution = {
    pageId,
    formId: lead.form_id,
    adId: lead.ad_id,
  };
  if (!lead.ad_id) return attribution;
  try {
    const ad = await graphGet<{
      name?: string;
      adset_id?: string;
      campaign_id?: string;
    }>(graphUrl(lead.ad_id, accessToken, 'name,adset_id,campaign_id'));
    attribution.adName = ad.name;
    attribution.adsetId = ad.adset_id;
    attribution.campaignId = ad.campaign_id;

    if (ad.adset_id) {
      const adset = await graphGet<{ name?: string }>(graphUrl(ad.adset_id, accessToken, 'name'));
      attribution.adsetName = adset.name;
    }
    if (ad.campaign_id) {
      const campaign = await graphGet<{ name?: string }>(
        graphUrl(ad.campaign_id, accessToken, 'name'),
      );
      attribution.campaignName = campaign.name;
    }
  } catch {
    // Attribution names may be unavailable without advanced ad permissions. IDs remain useful.
  }
  return attribution;
}
