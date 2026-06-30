import express from "express";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "25mb" }));
app.use(express.static(join(__dirname, "public")));

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const PLACES_KEY = process.env.GOOGLE_PLACES_API_KEY;

// Portfolio NetTurbo usado para o score de oportunidade (ajustavel)
const PORTFOLIO_NETTURBO = [
  "Link de internet dedicado (fibra) com SLA",
  "Banda larga empresarial / multi-link",
  "Wi-Fi corporativo gerenciado",
  "Telefonia IP / VoIP / PABX em nuvem",
  "IP fixo e conectividade ponto-a-ponto",
  "SD-WAN e redundancia de links",
  "Monitoramento de rede / NOC 24x7",
  "Solucoes de seguranca e firewall gerenciado",
];

// ---------- Helper generico: chama Gemini e devolve JSON ----------
async function chamarGeminiJSON(parts) {
  if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY nao configurada no .env");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const body = {
    contents: [{ parts }],
    generationConfig: { temperature: 0, responseMimeType: "application/json" },
  };
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${await r.text()}`);
  const data = await r.json();
  const txt = data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  try {
    return JSON.parse(txt);
  } catch {
    return { erro_parse: txt };
  }
}

// ---------- 1. VISAO: le a fachada e extrai dados estruturados ----------
async function lerFachada(base64, mime) {
  const prompt = `Voce e um assistente de prospeccao comercial. Analise a foto da FACHADA/PLACA de um estabelecimento comercial brasileiro e extraia o que conseguir LER ou inferir com seguranca.
Responda APENAS um JSON valido, sem texto extra, neste formato:
{
  "nome_fantasia": "",
  "ramo": "",
  "cidade": "",
  "telefones": [],
  "cnpj": "",
  "site": "",
  "redes_sociais": [],
  "outros_textos": "",
  "confianca": "alta|media|baixa"
}
Regras: se nao tiver certeza de um campo, deixe vazio. CNPJ apenas digitos. Nao invente dados.`;

  return chamarGeminiJSON([
    { text: prompt },
    { inline_data: { mime_type: mime, data: base64 } },
  ]);
}

// ---------- 1b. IA le o SITE da empresa: inteligencia comercial + score ----------
async function analisarSite(site, nome, ramo) {
  if (!site) return null;
  let base;
  try {
    base = new URL(site).origin;
  } catch {
    return null;
  }
  // junta texto de algumas paginas relevantes
  const paths = ["", "/sobre", "/quem-somos", "/servicos", "/produtos", "/contato", "/institucional"];
  let texto = "";
  for (const path of paths) {
    if (texto.length > 18000) break;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      const r = await fetch(base + path, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; radar-vendas-poc)" },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!r.ok) continue;
      const html = await r.text();
      const limpo = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ");
      texto += "\n[" + (path || "/") + "] " + limpo.slice(0, 5000);
    } catch {
      /* segue */
    }
  }
  if (texto.trim().length < 120) return { site_inacessivel: true };

  const prompt = `Voce e um analista de prospeccao B2B de um PROVEDOR DE INTERNET/TELECOM (NetTurbo).
Abaixo esta o texto do site da empresa "${nome || ""}" (ramo: ${ramo || "?"}).
Extraia inteligencia comercial e avalie a oportunidade de venda dos servicos da NetTurbo.

Portfolio NetTurbo disponivel:
${PORTFOLIO_NETTURBO.map((s) => "- " + s).join("\n")}

Responda APENAS JSON valido neste formato:
{
  "resumo": "2-3 frases sobre o que a empresa faz",
  "servicos_oferecidos": [],
  "email": "",
  "redes_sociais": [],
  "cnpj": "",
  "porte_aparente": "micro|pequeno|medio|grande|indefinido",
  "indicios_ti": "sinais de necessidade de conectividade/TI que voce notou",
  "score_oportunidade": 0,
  "servicos_netturbo_alvo": [],
  "gancho_abordagem": "1 frase de abordagem pronta para o vendedor usar"
}
Regras: score_oportunidade e um numero de 0 a 100 (quanto essa empresa precisa dos servicos NetTurbo). cnpj apenas digitos, vazio se nao houver. Nao invente dados; use so o que o texto suporta.

TEXTO DO SITE:
${texto.slice(0, 20000)}`;

  return chamarGeminiJSON([{ text: prompt }]);
}

// ---------- 2. ENRIQUECIMENTO: CNPJ (BrasilAPI, gratis) ----------
async function enriquecerCnpj(cnpj) {
  const limpo = (cnpj || "").replace(/\D/g, "");
  if (limpo.length !== 14) return null;
  try {
    const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${limpo}`);
    if (!r.ok) return null;
    const d = await r.json();
    return {
      cnpj: d.cnpj,
      razao_social: d.razao_social,
      nome_fantasia: d.nome_fantasia,
      situacao: d.descricao_situacao_cadastral,
      porte: d.porte,
      capital_social: d.capital_social,
      cnae: `${d.cnae_fiscal} - ${d.cnae_fiscal_descricao}`,
      abertura: d.data_inicio_atividade,
      endereco: `${d.logradouro}, ${d.numero} - ${d.bairro}, ${d.municipio}/${d.uf}`,
      telefone: [d.ddd_telefone_1, d.ddd_telefone_2].filter(Boolean).join(" / "),
      email: d.email,
      socios: (d.qsa || []).map((s) => s.nome_socio),
    };
  } catch {
    return null;
  }
}

// ---------- 2b. Geocodificacao reversa do GPS (Nominatim, gratis) ----------
async function enderecoPorGps(lat, lng) {
  if (lat == null || lng == null) return null;
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`,
      { headers: { "User-Agent": "radar-vendas-poc/0.1" } }
    );
    if (!r.ok) return null;
    const d = await r.json();
    const a = d.address || {};
    return {
      display: d.display_name || null,
      cidade: a.city || a.town || a.municipality || a.village || null,
      uf: ufSigla(a.state),
    };
  } catch {
    return null;
  }
}

const UFS = {
  acre: "AC", alagoas: "AL", amapá: "AP", amazonas: "AM", bahia: "BA",
  ceará: "CE", "distrito federal": "DF", "espírito santo": "ES", goiás: "GO",
  maranhão: "MA", "mato grosso": "MT", "mato grosso do sul": "MS",
  "minas gerais": "MG", pará: "PA", paraíba: "PB", paraná: "PR",
  pernambuco: "PE", piauí: "PI", "rio de janeiro": "RJ",
  "rio grande do norte": "RN", "rio grande do sul": "RS", rondônia: "RO",
  roraima: "RR", "santa catarina": "SC", "são paulo": "SP", sergipe: "SE",
  tocantins: "TO",
};
function ufSigla(estado) {
  if (!estado) return null;
  return UFS[estado.toLowerCase()] || null;
}

// ---------- 2c. Ponte nome -> CNPJ (Casa dos Dados, gratis/best-effort) ----------
async function buscarCnpjPorNome(nome, uf, municipio) {
  if (!nome) return null;
  try {
    const r = await fetch("https://api.casadosdados.com.br/v2/public/cnpj/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: {
          termo: [nome],
          atividade_principal: [],
          natureza_juridica: [],
          uf: uf ? [uf] : [],
          municipio: municipio ? [municipio.toUpperCase()] : [],
          situacao_cadastral: "ATIVA",
        },
        range_query: {},
        extras: {},
        page: 1,
      }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    const lista = d?.data?.cnpj || [];
    return lista.slice(0, 3).map((c) => ({
      cnpj: c.cnpj,
      razao_social: c.razao_social,
      nome_fantasia: c.nome_fantasia,
      municipio: c.municipio,
      uf: c.uf,
    }));
  } catch {
    return null;
  }
}

// ---------- 2d. Google Places (opcional, confirma empresa) ----------
async function buscarPlaces(nome, ramo, cidade) {
  if (!PLACES_KEY || !nome) return null;
  const textQuery = [nome, ramo, cidade].filter(Boolean).join(" ");
  try {
    const r = await fetch(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": PLACES_KEY,
          "X-Goog-FieldMask": [
            "places.displayName",
            "places.formattedAddress",
            "places.nationalPhoneNumber",
            "places.internationalPhoneNumber",
            "places.websiteUri",
            "places.googleMapsUri",
            "places.rating",
            "places.userRatingCount",
            "places.businessStatus",
            "places.primaryTypeDisplayName",
            "places.types",
            "places.editorialSummary",
            "places.regularOpeningHours",
            "places.priceLevel",
          ].join(","),
        },
        body: JSON.stringify({ textQuery, languageCode: "pt-BR", regionCode: "BR" }),
      }
    );
    if (!r.ok) return null;
    const d = await r.json();
    const p = d?.places?.[0];
    if (!p) return null;
    return {
      nome: p.displayName?.text,
      endereco: p.formattedAddress,
      telefone: p.nationalPhoneNumber || p.internationalPhoneNumber,
      site: p.websiteUri,
      maps: p.googleMapsUri,
      avaliacao: p.rating,
      qtd_avaliacoes: p.userRatingCount,
      status: p.businessStatus,
      categoria: p.primaryTypeDisplayName?.text,
      resumo: p.editorialSummary?.text,
      horario: p.regularOpeningHours?.weekdayDescriptions,
    };
  } catch {
    return null;
  }
}

// ---------- 2e. Extrai CNPJ do site da empresa (GRATIS) ----------
const CNPJ_RE = /\b(\d{2}[.\s]?\d{3}[.\s]?\d{3}[\/\s]?\d{4}[-\s]?\d{2})\b/g;

async function cnpjDoSite(site) {
  if (!site) return null;
  let base;
  try {
    base = new URL(site).origin;
  } catch {
    return null;
  }
  // paginas onde o CNPJ costuma aparecer (rodape / institucional)
  const paths = ["", "/contato", "/sobre", "/quem-somos", "/institucional", "/politica-de-privacidade", "/empresa"];
  for (const path of paths) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      const r = await fetch(base + path, {
        headers: { "User-Agent": "Mozilla/5.0 radar-vendas-poc" },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!r.ok) continue;
      const html = await r.text();
      const texto = html.replace(/<[^>]+>/g, " ");
      const m = texto.match(CNPJ_RE);
      if (m && m.length) {
        const limpo = m[0].replace(/\D/g, "");
        if (limpo.length === 14) return { cnpj: limpo, origem: base + path };
      }
    } catch {
      /* segue tentando os outros paths */
    }
  }
  return null;
}

// ---------- Endpoint principal ----------
app.post("/api/analisar", async (req, res) => {
  try {
    const { imagem, mime, lat, lng } = req.body || {};
    if (!imagem) return res.status(400).json({ erro: "imagem ausente" });

    const fachada = await lerFachada(imagem, mime || "image/jpeg");

    // GPS primeiro: define cidade/UF para escopar as buscas.
    // Em campo (celular na fachada) o GPS é a verdade; a "cidade" que o Gemini
    // infere da placa é palpite (e tende a chutar São Paulo) — por isso GPS tem
    // prioridade, e a cidade da fachada só entra como fallback se não houver GPS.
    const gps = await enderecoPorGps(lat, lng);
    const cidade = gps?.cidade || fachada.cidade || null;

    // Confirma a empresa no Places (nome oficial, telefone, site, avaliacoes)
    const places = await buscarPlaces(fachada.nome_fantasia, fachada.ramo, cidade);

    // IA le o SITE da empresa -> inteligencia comercial + score de oportunidade
    const site = places?.site || fachada.site || null;
    const siteInfo = await analisarSite(site, places?.nome || fachada.nome_fantasia, fachada.ramo);

    // CNPJ por ordem de confianca: 1) fachada  2) extraido do site pela IA
    let cnpjOrigem = null;
    let cnpjAlvo = (fachada.cnpj || "").replace(/\D/g, "");
    if (cnpjAlvo.length === 14) cnpjOrigem = "fachada";
    if (!cnpjOrigem && siteInfo?.cnpj) {
      const c = String(siteInfo.cnpj).replace(/\D/g, "");
      if (c.length === 14) { cnpjAlvo = c; cnpjOrigem = "site"; }
    }
    const cnpjInfo = await enriquecerCnpj(cnpjAlvo);

    res.json({
      fachada,
      places,
      inteligencia: siteInfo,
      site_analisado: site,
      cnpj: cnpjInfo,
      cnpj_origem: cnpjInfo ? cnpjOrigem : null,
      endereco_gps: gps?.display || null,
      cidade_usada: cidade,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: String(e.message || e) });
  }
});

const PORT = process.env.PORT || 4500;
app.listen(PORT, () => console.log(`Radar de Vendas PoC -> http://localhost:${PORT}`));
