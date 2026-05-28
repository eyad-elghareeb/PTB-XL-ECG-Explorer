import { NextRequest, NextResponse } from "next/server";

function detectSourceLanguage(text: string): "de" | "sv" | "auto" | "en" {
  if (/[äöüÄÖÜß]|Linkstyp|Rechtstyp|Schenkelblock|Vorhof|Herz|Infarkt|Strecke|Sinusrhythmus/i.test(text)) {
    return "de";
  }
  if (/[åäöÅÄÖ]|vänster|höger|sinusrytm|förmaks|hjärt/i.test(text)) {
    return "sv";
  }
  if (/\b(normal|sinus|rhythm|block|infarction|ischemia|axis|ventricular|atrial|left|right|heart|ecg)\b/i.test(text)) {
    return "en";
  }
  return "auto";
}

async function translateWithMyMemory(text: string, source: string, target: string): Promise<string> {
  const langPair = `${source === "auto" ? "de" : source}|${target}`;
  const url = new URL("https://api.mymemory.translated.net/get");
  url.searchParams.set("q", text);
  url.searchParams.set("langpair", langPair);

  const res = await fetch(url, {
    headers: {
      Accept: "application/json"
    },
    next: { revalidate: 60 * 60 * 24 }
  });

  if (!res.ok) {
    throw new Error(`MyMemory returned HTTP ${res.status}`);
  }

  const payload = await res.json();
  const translated = String(payload?.responseData?.translatedText || "").trim();
  if (!translated || translated.toLowerCase() === "null") {
    throw new Error("MyMemory returned an empty translation");
  }
  return translated;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const text = String(body?.text || "").trim();
    const target = String(body?.target || "en").trim().toLowerCase();
    const requestedSource = String(body?.source || "").trim().toLowerCase();

    if (!text) {
      return NextResponse.json({ error: "Missing text to translate" }, { status: 400 });
    }
    if (target !== "en") {
      return NextResponse.json({ error: "Only English target translation is supported" }, { status: 400 });
    }

    const detectedSource = requestedSource || detectSourceLanguage(text);
    if (detectedSource === "en") {
      return NextResponse.json({
        translatedText: text,
        source: "en",
        target,
        provider: "local-language-check",
        skipped: true
      });
    }

    const translatedText = await translateWithMyMemory(text, detectedSource, target);
    return NextResponse.json({
      translatedText,
      source: detectedSource === "auto" ? "de" : detectedSource,
      target,
      provider: "MyMemory"
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Translation unavailable";
    return NextResponse.json({
      error: message,
      translatedText: "",
      source: "auto",
      target: "en",
      provider: "MyMemory"
    }, { status: 502 });
  }
}
