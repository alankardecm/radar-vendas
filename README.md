# 📡 Radar de Vendas — PoC

Tira foto de uma **fachada** e devolve um **dossiê da empresa** para prospecção comercial.

## Fluxo
1. 📷 Foto da fachada (+ GPS do celular)
2. 👁️ Modelo de visão (Gemini) lê nome, telefone, CNPJ, ramo
3. 🏢 BrasilAPI enriquece com dados da Receita (razão social, sócios, CNAE, porte, capital)
4. 📍 Google Places (opcional) confirma empresa/endereço
5. 🛰️ Nominatim resolve o endereço pelo GPS

Tudo com stack **gratuito**.

## Como rodar
```powershell
cd radar-vendas-poc
npm install
copy .env.example .env   # e preencha GEMINI_API_KEY
npm start
```
Abra http://localhost:4500 (no celular: use o IP da máquina na mesma rede).

### Chaves
- **GEMINI_API_KEY** (obrigatória, grátis): https://aistudio.google.com/apikey
- **GOOGLE_PLACES_API_KEY** (opcional): crédito grátis US$200/mês.

## O que validar nesta PoC
- A visão acerta o nome/ramo da fachada?
- Quando a fachada mostra CNPJ, o enriquecimento casa?
- O GPS ajuda a localizar a empresa certa?

## Limitação conhecida
A ponte **nome → CNPJ** automática (sem o CNPJ visível na placa) exige base paga
(CNPJá/Casa dos Dados) ou Google Places. Nesta PoC, o CNPJ é enriquecido quando
aparece na fachada ou via Places. Próximo passo se a PoC validar.
