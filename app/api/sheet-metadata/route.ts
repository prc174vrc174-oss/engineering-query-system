const METADATA_WEB_APP_URL =
  "https://script.google.com/macros/s/AKfycbw2WWjD9NKQKYNYLnVtU0E7xLKe69ELXw1FeIeEMUaFGY0zintiPAhwsnCC_figFrEScQ/exec";

type MetadataResponse = {
  ok?: boolean;
  formattedLastUpdated?: string;
  lastUpdated?: string;
};

export async function GET() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const callbackName = "sheetMetadataCallback";
    const upstreamUrl = new URL(METADATA_WEB_APP_URL);
    upstreamUrl.searchParams.set("callback", callbackName);
    upstreamUrl.searchParams.set("_", Date.now().toString());

    const response = await fetch(upstreamUrl, {
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Metadata request failed: ${response.status}`);
    }

    const body = (await response.text()).trim();
    let data: MetadataResponse;

    try {
      data = JSON.parse(body) as MetadataResponse;
    } catch {
      const jsonpMatch = body.match(
        new RegExp(`^${callbackName}\\((.*)\\);?$`, "s"),
      );
      if (!jsonpMatch) throw new Error("Invalid metadata response");
      data = JSON.parse(jsonpMatch[1]) as MetadataResponse;
    }

    if (!data.ok || !data.formattedLastUpdated) {
      throw new Error("Metadata response did not include a modified time");
    }

    return Response.json(data, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch {
    return Response.json(
      { ok: false, error: "Unable to read sheet metadata" },
      {
        status: 502,
        headers: { "Cache-Control": "no-store, max-age=0" },
      },
    );
  } finally {
    clearTimeout(timeout);
  }
}
