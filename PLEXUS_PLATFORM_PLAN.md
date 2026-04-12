# Plexus Platform — Uygulama Geliştirme Raporu

## 1. Teknoloji Stack'i

**Backend:** Node.js + Express.js + TypeScript, MongoDB (Mongoose), Zod validation, Jest test. Cache şu anlık in-memory (`ICacheStore` abstraction'ı ardında); Redis + BullMQ ilerleyen fazlarda ihtiyaç doğduğunda eklenecek, API değişmeden swap edilecek.
**Frontend:** React + Vite + TypeScript, Mantine UI, Jotai (state management), React Router, Mermaid.js renderer.
**SDK:** TypeScript (`@plexus/sdk`).
**AI Providers:** OpenAI + Anthropic SDK'ları, provider-agnostic adapter katmanı.
**Infra:** Docker Compose (dev, yalnızca MongoDB), MongoDB Atlas (prod). Redis ileride eklenecek.

## 2. Clean Architecture — Katman Yapısı

Backend dört katmana ayrılmalı. Dependency yönü **dışarıdan içeriye**: domain hiçbir şeye bağımlı değil, infrastructure her şeyi bilir.

```
src/
├── domain/              # Pure TS, zero dependencies
│   ├── entities/        # Prompt, Version, Benchmark, Graph, Agent
│   ├── value-objects/   # PPD, TokenCost, GraphQualityScore
│   └── repositories/    # Interfaces only (IPromptRepository)
│
├── application/         # Use cases, orchestration
│   ├── use-cases/       # CreatePrompt, RunBenchmark, GenerateBraid
│   ├── services/        # BraidGenerator, GraphLinter, Judge
│   └── dto/
│
├── infrastructure/      # Framework & external concerns
│   ├── persistence/     # Mongoose models + repository impls
│   ├── ai-providers/    # OpenAI, Anthropic adapters
│   ├── queue/           # BullMQ workers
│   └── cache/           # Redis graph cache
│
└── presentation/        # Express controllers, routes, middleware
    ├── http/
    └── sdk-api/         # SDK'nın konuştuğu public endpoint
```

**Kritik kural:** `domain` import etmez. `application` sadece `domain` import eder. `infrastructure` repository interface'lerini `domain`den alıp implement eder. `presentation` use case'leri çağırır, asla domain/infra'ya direkt dokunmaz.

## 3. Frontend State Management — Jotai Stratejisi

Jotai atomic state management ile hem client hem server state'i yönetilecek. TanStack Query ve Zustand kullanılmayacak.

**Atom organizasyonu:**
```
src/atoms/
├── auth.atoms.ts          # userAtom, tokenAtom
├── prompts.atoms.ts       # promptsAtom, selectedPromptAtom
├── benchmarks.atoms.ts    # benchmarkRunAtom, benchmarkResultsAtom
├── ui.atoms.ts            # sidebarOpenAtom, themeAtom
└── async/
    ├── promptsQuery.ts    # atomWithQuery pattern
    └── benchmarkQuery.ts
```

**Server state için pattern:** `atomWithQuery` benzeri custom async atom — fetch fonksiyonu + loading/error state + manual refetch. `jotai-tanstack-query` yerine kendi ince wrapper'ımızı yazalım ki bağımlılık yüzeyi küçük kalsın.

```ts
// Örnek: async data atom
export const promptsAtom = atom(async (get) => {
  const token = get(tokenAtom);
  const res = await api.get('/prompts', { token });
  return res.data;
});

// Write atom for mutations
export const createPromptAtom = atom(
  null,
  async (get, set, payload: CreatePromptDto) => {
    const result = await api.post('/prompts', payload);
    set(promptsRefreshAtom, (n) => n + 1); // trigger refetch
    return result;
  }
);
```

**Refresh pattern:** her async atom bir `refreshAtom` (sayaç) dependency'si alır, mutation sonrası sayaç artar → atom yeniden fetch eder. TanStack Query'nin `invalidateQueries` davranışının manuel karşılığı.

**Cache:** Jotai atom'ları component unmount olsa da provider seviyesinde yaşar. Global cache için `Provider` root'ta tek kurulum yeterli.

## 4. Domain Modeli — Temel Entity'ler

- **Prompt:** `id, name, description, taskType, ownerId, createdAt`
- **PromptVersion:** `id, promptId, version (semver), classicalPrompt, braidGraph, generatorModel, solverModel, status (draft|staging|production), createdAt`
- **BraidGraph:** `mermaidCode, nodes[], edges[], qualityScore, generatedBy, generatedAt`
- **Benchmark:** `id, promptVersionIds[], datasetId, metrics (accuracy, ppd, cost, latency, judgeScore, consistency), status, results[]`
- **Dataset:** `id, name, taskType, testCases[] (input, expectedOutput?, masked?)`
- **ExecutionLog:** `id, promptVersionId, input, output, tokensIn, tokensOut, cost, latency, modelUsed, timestamp` — SDK traces
- **Agent:** `id, promptVersionId, apiKey, endpoint, usageStats`

## 5. Geliştirme Adımları (Sıralı)

### Faz 0 — Temel (1 hafta)
1. Monorepo kurulumu (pnpm workspaces: `apps/api`, `apps/web`, `packages/sdk`, `packages/shared-types`).
2. Docker Compose: MongoDB + Redis.
3. Express + TS iskeleti, Clean Architecture klasör yapısı, Zod, error handler middleware.
4. Auth (JWT + refresh), User entity, `/auth` endpoints.
5. React + Mantine + Jotai iskeleti, Provider root kurulumu, login sayfası, layout/sidebar.
6. `auth.atoms.ts` — userAtom, tokenAtom (localStorage persistence `atomWithStorage`).

### Faz 1 — Prompt Yönetimi (1 hafta)
7. Domain: `Prompt`, `PromptVersion` entity + repository interface.
8. Use case'ler: `CreatePrompt`, `CreateVersion`, `PromoteVersion` (draft→staging→production), `ListPrompts`.
9. Mongoose şemaları + repository impl.
10. REST endpoints + controller tests.
11. Frontend: `prompts.atoms.ts` (async read + mutation atoms), prompt listesi, detay, version editor (Monaco editor), diff view.

### Faz 2 — AI Provider Adapter Katmanı (3-4 gün)
12. `IAIProvider` interface (generate, countTokens, getPricing).
13. OpenAI + Anthropic adapter implementasyonları.
14. Provider factory + model registry (model adı → provider + pricing).
15. Token cost hesaplama value object (`TokenCost.calculate(model, tokensIn, tokensOut)`).

### Faz 3 — BRAID Generation (1 hafta)
16. `BraidGenerator` service — paper Appendix A.1 prompt'unu temel al, task type'a göre varyantlar (math, creative, instruction-following).
17. Mermaid parser — generated output'u parse edip `BraidGraph` entity'sine çevir, syntax validation.
18. `GenerateBraid` use case — classical prompt + model → BraidGraph.
19. **Graph cache** (Redis): key = `hash(classicalPrompt + generatorModel + taskType)`, TTL uzun. Amortized cost için hit count track et.
20. Frontend: "Generate BRAID" butonu, Mermaid.js ile render, side-by-side classical/braid view, generation state Jotai atom ile.

### Faz 4 — Graph Linter (4-5 gün)
Paper'daki 4 prensibin otomatik kontrolü:
21. **Node Atomicity Checker:** her node'un token sayısı <15 mi.
22. **Answer Leakage Detector:** node içinde literal çıktı var mı — regex + küçük LLM check.
23. **Verification Coverage:** terminal Check/Critic nodları var mı.
24. **Edge Determinism:** koşul etiketli edge oranı.
25. Her biri 0-100 skor, weighted `GraphQualityScore` value object.
26. Frontend: linter sonuçları panel, uyarılar inline.

### Faz 5 — Dataset & Benchmark (1.5 hafta)
27. `Dataset` entity + CRUD, CSV/JSON import.
28. **Numerical masking helper** — math dataset'leri için sayıları `_` ile maskele.
29. `LLMJudge` service — farklı provider'dan judge, rubric tabanlı (accuracy 1-5, coherence 1-5, instruction 1-5), position bias mitigation (iki yönlü çalıştır), verbosity penalty.
30. `BenchmarkRunner` — BullMQ worker:
    - Test case'leri paralel çalıştır
    - Classic ve BRAID versiyonlarını aynı input'ta karşılaştır
    - Her run için: accuracy, latency, cost, tokens topla
    - PPD hesapla (eq. 4): `(acc/cost) / (acc_baseline/cost_baseline)`
    - Consistency: aynı input N kez, semantic similarity variance
31. `RunBenchmark` use case + progress SSE.
32. Frontend: benchmark sayfası, dataset seçimi, canlı progress (SSE → atom), sonuç grafikleri (Recharts), `benchmarks.atoms.ts`.

### Faz 6 — PPD Dashboard & Golden Quadrant Recommender (4-5 gün)
33. Her benchmark sonrası generator × solver matrisi üret (paper Table 1/2/3 mantığı).
34. `RecommendOptimalPair` use case — en yüksek PPD veren çifti öner, "mevcut setup'a göre Nx tasarruf" mesajı.
35. Dashboard: PPD heatmap, model efficiency breakdown, cost trend grafikleri.

### Faz 7 — SDK & Execution Runtime (1 hafta)
36. `packages/sdk/` — TypeScript SDK:
    ```ts
    const prompt = new Prompt("summarizer@v3", { apiKey });
    const result = await prompt.run({ text: "..." });
    ```
37. Version pinning zorunlu (`@latest` yok, `@production` default).
38. Her `.run()` otomatik log → backend `/sdk/execute` endpoint → `ExecutionLog`.
39. **Split execution runtime** backend'de: cached graph'ı Redis'ten çek, solver model'e gönder, sonucu stream et.
40. Shadow mode: prod v3 çalışırken v4'ü arka planda paralel çalıştır, karşılaştır.
41. Retry + fallback (provider A fail → B).
42. SDK README + örnek usage.

### Faz 8 — Agent Katmanı (3-4 gün)
43. `Agent` entity — bir prompt version'ı public endpoint'e expose eden wrapper.
44. Her agent için API key, rate limit, usage quota.
45. `POST /agents/:id/invoke` endpoint — public, API key auth.
46. Frontend: agent oluşturma wizard, API key management, usage dashboard.

### Faz 9 — Production Traces & Analiz (4-5 gün)
47. Execution log viewer (filtreleme, arama, detay modal).
48. Periyodik analiz job (BullMQ cron): son N log → LLM'e "bu prompt hangi durumlarda başarısız, nasıl iyileştirilebilir" sorusu → **suggestion** üret, otomatik uygulama yok.
49. Frontend: "Improvement Suggestions" paneli, kullanıcı onaylayıp yeni version açabilir.

### Faz 10 — Polish & Deploy (1 hafta)
50. E2E testler (Playwright), kritik akışlar.
51. Rate limiting, CORS, helmet, input sanitization.
52. OpenAPI spec + Swagger UI.
53. Logging (pino) + error tracking (Sentry).
54. CI/CD (GitHub Actions): lint, test, build, deploy.
55. Production deploy: API (Railway/Fly), web (Vercel), Mongo Atlas, Redis (Upstash).

## 6. Kritik Mimari Kararlar

- **Repository pattern şart** — test edilebilirlik ve MongoDB'den ileride kaçabilme için.
- **Use case'ler controller'dan izole** — her use case kendi input/output DTO'suna sahip, controller sadece HTTP mapping.
- **BullMQ job'ları idempotent** — benchmark yarıda kesilirse resume edilebilsin.
- **Graph cache invalidation** — generator model veya generation prompt değişirse cache key değişir, eski cache kendiliğinden expire olur.
- **Shared types paketi** — `packages/shared-types` ile backend ve SDK aynı tip tanımlarını kullansın, drift olmasın.
- **Provider adapter'ları domain'e sızdırma** — `application/services/BraidGenerator` sadece `IAIProvider` interface'i görür, concrete OpenAI client'ı görmez.
- **Jotai atom organizasyonu** — feature bazlı klasör, async atom'lar ayrı alt klasörde, `atomWithStorage` ile persistence, mutation atom'ları refresh counter tetikler.

## 7. Riskler ve Önlemler

| Risk | Önlem |
|---|---|
| LLM-as-judge bias | Farklı provider + iki-yönlü + rubric |
| Benchmark maliyeti patlaması | Dataset size limit, cost estimate ön-gösterimi, dry-run modu |
| Graph cache stale | TTL + version key + manual invalidation endpoint |
| SDK prod'da regresyon | Zorunlu version pinning + shadow mode |
| Mermaid parse hataları | Generator output'unda retry + fallback classical mode |
| MongoDB query scalability | İndeksler (promptId, createdAt, status), pagination |
| Jotai async atom refetch karmaşası | Tek standart refresh counter pattern, her feature aynı şekilde |

## 8. Tahmini Süre

Tek developer, full-time: **~9-11 hafta** MVP'ye. Faz 0-6 core platform (~6 hafta), Faz 7-8 SDK + agent (~2 hafta), Faz 9-10 analiz + deploy (~2 hafta).

---

Başlamak için ilk somut adım: monorepo kurulumu + Clean Architecture iskeletini tek bir prompt CRUD üzerinden uçtan uca çalıştırmak (Faz 0 + Faz 1'in minimal dilimi). Bu walking skeleton sonra her yeni entity için şablon olur.
