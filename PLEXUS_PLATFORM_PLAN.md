# Plexus Platform — Uygulama Geliştirme Raporu

## 0. Mevcut Ürün Özeti ve Tamamlanma Analizi

Plexus, LLM prompt'larını versiyonlayıp karşılaştırmak için yapılmış bir prompt experimentation platformudur. Platforma kayıt olan birim **Organization**'dır; her organizasyon kendi içine kullanıcı davet eder ve roller (RBAC: `owner | admin | editor | approver | viewer`) atayarak yetkilendirme kurar. Kullanıcı giriş yapar, ait olduğu organizasyonun scope'unda bir `Prompt` oluşturur ve bunun birden fazla `PromptVersion`'ını yönetir (sıfırdan veya başka bir version'dan fork). Her version `draft → development → staging → production` workflow'undan geçer ve istenildiğinde başka bir version'la **side-by-side karşılaştırılabilir** (classical body, mermaid, variables, varsa benchmark metrikleri diff). Her version klasik prompt içerir; istenirse bundan, paper'daki BRAID kurallarına uygun şekilde graph üretmek üzere kurulmuş **BRAID agent** ile chat akışında **BRAID graph** üretilir veya mevcut graph yine chat ile ya da **render üzerinden manuel düzenleme** (node label edit, drag-drop layout, text-mode mermaid edit) ile refine edilir. Hem klasik prompt'a hem de BRAID node label'larına `{{variableName}}` formatında **template variable**'lar gömülebilir; SDK çağrısında `(promptId, vars)` ile bu değişkenler runtime'da substitute edilir. Üretilen graph lint edilir, yapısal kalite skoru çıkarılır ve seçilen prompt version'ları seçilen solver modeller üzerinde benchmark'a sokulur. Bir version'ın **production**'a geçmesi opsiyonel olarak organizasyon seviyesinde tanımlı bir **approval policy**'ye tabidir (örn. üç yetkili onayı sonrası otomatik promote); workflow'un diğer aşama geçişleri (draft→development, development→staging, geri geçişler) `prompt:promote` permission'ıyla direkt yapılır.

Benchmark akışında sistem test case üretir, kullanıcı draft aşamasında test case'leri düzenleyebilir, çalıştırma sırasında cevaplar toplanır, judge modellerle puanlanır, token/cost/latency metrikleri kaydedilir. Sonuç ekranı PPD (Performance-per-Dollar), Pareto frontier, confidence interval, composite ranking ve recommendation analizleri gösterir.

Mevcut kod durumuna göre core MVP'nin yaklaşık **%65-75**'i tamamlanmış; tüm uzun vadeli planın yaklaşık **%45-55**'i uygulanmış durumdadır.

**Büyük ölçüde tamamlanan alanlar:**
- Auth, protected frontend layout, prompt listesi ve prompt detail akışı.
- Prompt version oluşturma, isimlendirme, draft/staging/production durum geçişleri.
- BRAID generation, Mermaid parse/validation, graph render, chat ile graph üretme/refine etme.
- Graph linter ve `GraphQualityScore` paneli.
- Benchmark oluşturma, generated/manual test case düzenleme, in-process job ile benchmark başlatma, SSE progress stream.
- LLM judge skorlama, verbosity penalty, cost/latency/token kayıtları.
- Benchmark analysis: PPD, Pareto frontier, confidence interval, composite ranking ve recommendation.

**Kısmi veya eksik kalan alanlar:**
- AI provider katmanı mevcut, ancak runtime şu an Groq odaklıdır; OpenAI/Anthropic production adapter hedefi tamamlanmış sayılmaz.
- Cache ve queue abstraction'ları mevcut, ancak Redis/BullMQ yerine in-memory cache ve in-process queue kullanılır.
- Ayrı `Dataset` CRUD, CSV/JSON import ve numerical masking helper yok; test case'ler benchmark içinde yönetilir.
- `packages/sdk` iskeleti var, fakat SDK runtime, `/sdk/execute`, `ExecutionLog` ve production execution runtime yok.
- Public `Agent` entity/endpoints, API key yönetimi, usage dashboard, shadow mode ve retry/fallback runtime yok.
- Production traces viewer, periodic improvement suggestions, OpenAPI/Swagger, Playwright E2E, CI/CD ve deploy otomasyonu eksik.

**Yeni hedef kapsam (henüz uygulanmadı):**
- **Organization & üyelik (Faz 1B):** kayıt birimi organizasyondur; her org kendi kullanıcılarını davet eder. Mevcut `Prompt`/`PromptVersion`/`Benchmark` agregaları organizasyon-scope'una bağlanacak (`organizationId` + `creatorId`). Tüm read/write yolları organization isolation'ı ile filtrelenecek.
- **RBAC (Faz 1B):** organizasyon içinde rol tabanlı yetkilendirme (öneri: `owner`, `admin`, `editor`, `approver`, `viewer`). Permission matrisi tek yerde tanımlı, presentation katmanında declarative middleware ile uygulanır.
- **4-stage workflow (Faz 1):** `VersionStatus` mevcut `draft | staging | production` üçlüsünden `draft | development | staging | production` dörtlüsüne genişletilecek. `draft`'a geri dönüş yasaktır (mevcut domain kuralı korunur), diğer geçişler iki yönlü serbesttir.
- **Approval workflow (Faz 1C):** her organizasyon için opsiyonel `ApprovalPolicy` (production'a geçiş için minimum onay sayısı + onay verebilen roller). **Yalnız `→ production` geçişi** approval'a tabidir; bu geçişte `PromoteVersion` artık doğrudan promote yerine `VersionApprovalRequest` açar, threshold'a ulaşıldığında otomatik promote, policy yoksa veya kapalıysa eski davranış. Diğer aşama geçişleri her zaman direkt `prompt:promote` permission'ıyla yapılır.
- **Version comparison (Faz 1D):** aynı prompt'un iki version'ı side-by-side karşılaştırılır — classical body diff, mermaid graph diff, variables listesi diff (eklenen/kaldırılan/default değişen), varsa son benchmark sonuçlarının metrik diff'i.
- **Template variables (Faz 1 + Faz 3 + Faz 7):** klasik prompt body'si ve BRAID node label'larında `{{varName}}` placeholder'ları. `PromptVersion.variables[]` ile şema (name, default, required) tanımlanır. SDK `client.prompt(id).run({ vars: {...} })` çağrısında sunucu tarafında literal substitute edilir; ExecutionLog'a değerler PII policy'sine göre redact/hash'lenmiş şekilde girer.
- **BRAID agent (Faz 3):** paper kurallarına (atomicity, no leakage, deterministic edges, terminal verification) uygun graph üretmek/refine etmek üzere kurulmuş chat agent'ı. Backend **stateless**: her chat request'inde frontend full conversation history'yi POST eder, LLM çağrısı multi-turn context ile gider, ama backend conversation transcript'ini DB'ye yazmaz. Persist edilen tek artifact diagram'dır — kullanıcı bir öneriyi "kaydet" derse parent'ı conversation'ın başladığı version olan yeni bir `PromptVersion` (fork-on-save) açılır. Conversation kaydedilmeden bırakılırsa hiç iz kalmaz.
- **Visual graph editor (Faz 4B):** BRAID render üzerinde manuel düzenleme — node click → inline label edit, drag → position, edge add/remove/relabel; ayrıca text mode (Mermaid kodu Monaco). Tüm structural mutation'lar fork-on-edit (yeni version), layout-only değişimler version'a bağlı ama mutable.

## 1. Teknoloji Stack'i

**Backend:** Node.js + Express.js + TypeScript, MongoDB (Mongoose), Zod validation, Jest test. Cache şu anlık in-memory (`ICacheStore` abstraction'ı ardında); Redis + BullMQ ilerleyen fazlarda ihtiyaç doğduğunda eklenecek, API değişmeden swap edilecek.
**Frontend:** React + Vite + TypeScript, Mantine UI, Jotai (state management), React Router, Mermaid.js renderer.
**SDK:** TypeScript (`@plexus/sdk`).
**AI Providers:** Provider-agnostic adapter katmanı. Mevcut runtime Groq provider ile çalışır; OpenAI + Anthropic adapter hedefleri ileriki fazdadır.
**Infra:** Docker Compose (dev, yalnızca MongoDB), MongoDB Atlas (prod). Redis/BullMQ ileride eklenecek; mevcut cache/queue implementasyonları in-memory/in-process çalışır.

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

- **Organization:** `id, name, slug, ownerId, approvalPolicy?, createdAt` — kayıt birimi; tüm prompt/benchmark verisi bu scope altında. Invariant: org'da her zaman **tam bir** `owner` üyesi vardır (`Organization.ownerId` ↔ `OrganizationMember.role="owner"` aynı satıra işaret eder).
- **OrganizationMember:** `id, organizationId, userId, role, invitedBy, joinedAt, lastActiveAt?` — `(organizationId, userId)` unique. Rol set'i sabit enum: `owner | admin | editor | approver | viewer`.
- **OrganizationInvitation:** `id, organizationId, email, role, invitedBy, token (random, unique, hashed at rest), status (pending|accepted|cancelled|expired), expiresAt (createdAt + 7 gün), createdAt, resolvedAt?`. `(organizationId, email)` üzerinde aktif (status="pending") tek satır kuralı (yeni davet açılmadan önce eski iptal edilmeli).
- **OrganizationMembershipEvent** (audit log): `id, organizationId, eventType (invited|cancelled|joined|role_changed|removed|ownership_transferred), actorUserId, targetUserId?, targetEmail?, oldRole?, newRole?, timestamp`. Her membership-değiştiren use case bu kaydı yazar (UoW içinde, asıl mutation ile atomik).
- **ApprovalPolicy** (Organization value object'i veya alt entity'si): `requiredApprovals (n), eligibleRoles[]` — production'a geçiş için kaç onay, hangi roller onay verebilir. Yoksa direkt promote.
- **VersionApprovalRequest:** `id, promptVersionId, requestedBy, status (pending|approved|rejected|cancelled), approvals[] ({userId, decidedAt, comment?}), createdAt, resolvedAt?` — production'a geçiş talebi.
- **Prompt:** `id, organizationId, creatorId, name, description, taskType, productionVersionId?, versionCounter, createdAt`
- **PromptVersion:** `id, promptId, version (label "v1", "v2", ...), name, classicalPrompt, braidGraph?, variables[], authorship, generatorModel?, generationCost? (token cost meta — diagram kaydedilen turn'ün cost'u), status (draft|development|staging|production), parentVersionId?, createdAt`
- **PromptVariable** (PromptVersion alt VO listesi): `name (slug, regex `^[a-zA-Z_][a-zA-Z0-9_]*$`), description?, defaultValue?, required (bool)`. Sadece string tip — başka tip ihtiyacı doğunca eklenir (YAGNI). Aynı `name` iki kez tanımlanamaz; tüm referanslar (`{{name}}`) tanımlı set'in alt kümesi olmalıdır (validation use case seviyesinde).
- **BraidGraph:** `mermaidCode, nodes[], edges[], qualityScore, generatedBy, generatedAt`. Node label'ları `{{varName}}` placeholder içerebilir; parser bunları yapısal node sayımına dahil etmez (atomicity skoru hesabında görmezden gelinir).
- **BraidAgent (entity değil, application service):** paper §A.4 kurallarına uygun BRAID graph üretmek/refine etmek üzere kurulmuş chat agent'ı. Domain entity DEĞİL — conversation persist edilmediği için aggregate yok. `IBraidChatAgentFactory` + per-model agent class'ları application layer'ında. System prompt'u paper kurallarını + mevcut version'ın source prompt'unu + linter feedback'ini içerir. Tek persist edilen artifact `PromptVersion` (kullanıcı sohbetten çıkan diagram'ı kaydederse fork açılır).
- **Benchmark:** `id, organizationId, creatorId, promptVersionIds[], datasetId, metrics (accuracy, ppd, cost, latency, judgeScore, consistency), status, results[]`
- **Dataset:** `id, organizationId, name, taskType, testCases[] (input, expectedOutput?, masked?)`
- **ExecutionLog:** `id, organizationId, promptVersionId, input, output, tokensIn, tokensOut, cost, latency, modelUsed, timestamp` — SDK traces
- **Agent (public):** `id, organizationId, promptVersionId, apiKey, endpoint, usageStats` — Faz 8 public API agent'ı (BraidAgent ile karıştırılmasın).

## 5. Geliştirme Adımları (Sıralı)

### Faz 0 — Temel (1 hafta)
1. Monorepo kurulumu (pnpm workspaces: `apps/api`, `apps/web`, `packages/sdk`, `packages/shared-types`).
2. Docker Compose: MongoDB + Redis.
3. Express + TS iskeleti, Clean Architecture klasör yapısı, Zod, error handler middleware.
4. Auth (JWT + refresh), User entity, `/auth` endpoints. **Kayıt akışı (`/auth/register`) yeni bir `Organization` ile beraber kullanıcıyı `owner` rolünde üye yapar** — User → Organization tek atomik işlem.
5. React + Mantine + Jotai iskeleti, Provider root kurulumu, login sayfası, layout/sidebar.
6. `auth.atoms.ts` — userAtom, tokenAtom (localStorage persistence `atomWithStorage`), `currentOrganizationAtom` (kullanıcı birden fazla org'a üye olabileceği için aktif organizasyon seçimi).

### Faz 1 — Prompt Yönetimi (Organization-scoped) (1 hafta)
7. Domain: `Prompt`, `PromptVersion` entity + repository interface. `VersionStatus` enum **`draft | development | staging | production`** (4 aşama). `draft`'a geri dönüş yasak; diğer geçişler iki yönlü serbest. Tüm read/write yolları `organizationId` ile filtrelenir; `creatorId` ayrıca tutulur (kim oluşturdu izi). `PromptVersion.variables[]` listesi ve klasik prompt body'sindeki `{{varName}}` referanslarını parse eden `extractVariableReferences(body)` helper'ı domain layer'da.
8. Use case'ler: `CreatePrompt`, `CreateVersion` (parent'tan fork veya sıfırdan), `PromoteVersion` (her aşama-arası transition), `ListPrompts`. `CreateVersion` ve içeriği değiştiren tüm fork'lar (Faz 3+'de geleceklerin hepsi dahil) **variable bütünlüğünü** doğrular: prompt body'sindeki tüm `{{x}}` referansları `variables[]` içinde tanımlı; tanımlı her variable en az bir yerde referans verilmiş (referans verilmemişse warning, eksik referans error). `PromoteVersion` Faz 1C'de **yalnızca `→ production` geçişinde** approval policy ile genişletilecek (geriye uyumlu, policy yoksa direkt promote).
9. Mongoose şemaları + repository impl. Index: `(organizationId, createdAt)`, `(organizationId, name)`.
10. REST endpoints + controller tests. Authorization middleware her route'ta `currentOrganizationId` ve gerekli permission'ı declare eder (Faz 1B'de gelecek RBAC tablosuna bağlanır). Tüm aşama geçişleri tek `prompt:promote` permission'ı ister.
11. Frontend: `prompts.atoms.ts` (async read + mutation atoms — aktif organization'a göre fetch), prompt listesi, detay, version editor (Monaco editor + body içinde `{{var}}` syntax highlight + sağ panel "Variables" — her satır `name | description | default | required`), aşama geçiş kontrolleri (4 stage badge + ileri/geri promote butonları, kullanıcının permission'ına göre disable). Diff view ayrı Faz 1D'de.

> **Variable editor scope (önemli ayrım):** sağ paneldeki Variables UI **yalnızca şemayı** girer (`name | description | default | required`). Variable **değerleri** burada girilmez — değerler SDK runtime'ında `client.prompt(id).run({ vars: {...} })` çağrısıyla gelir, server-side substitute edilir (Faz 7). Frontend ad-hoc "test değeri girip preview yap" özelliği YAGNI; ileride bir "Test Runner" eklenirse o akış ayrı tasarlanır, version'ın `variables[]` şemasına dokunmaz.

> **Mevcut kod refactor'u (Faz 1 implementasyonunun parçası):** `shared-types` ve domain'deki `VersionStatus` `"draft" | "staging" | "production"` → `"draft" | "development" | "staging" | "production"`. `PromptInvalidVersionTransitionError` aynı kalır, kabul edilen değer set'i genişler. Mevcut staging kullanan testler/UI dropdown'ları güncellenir. (Plan onayından sonra ayrı task.)

### Faz 1B — Organization, Üyelik & RBAC (5-6 gün)
Bağımlılık: Faz 1.

**Domain & permission map**
- `Organization`, `OrganizationMember`, `OrganizationInvitation` (pending davetler için), `OrganizationMembershipEvent` (audit log entity'si) — hepsi repository interface'i ile.
- Sabit rol enum (`owner | admin | editor | approver | viewer`) ve **rol → permission map**'i tek bir `permissions.ts` modülünde. Permission örnekleri: `org:settings:edit`, `org:delete`, `member:invite`, `member:role:update`, `member:remove`, `ownership:transfer`, `prompt:create`, `prompt:edit`, `prompt:promote`, `version:approve`, `policy:edit`. Authorization middleware bu map'i tüketir; `switch(role)` zinciri iş kodunda yasak.
- **Invariants** (domain seviyesinde):
  - **Self-edit yasağı:** bir kullanıcı kendi `OrganizationMember` row'unda rol değiştiremez ve kendini çıkaramaz (escalation/lock-out koruması). Use case input'unda `actorUserId === targetUserId` ise reddedilir.
  - **Tek owner:** bir org'da herhangi bir anda **tam olarak bir** `owner` rolü bulunur. Owner rolü yalnızca `TransferOwnership` use case'i ile devredilir; `UpdateMemberRole` `owner` rolünü ne atar ne kaldırır.
  - **Son owner çıkamaz:** sahip kendini çıkaramaz; önce devretmeli ya da org'u silmeli.

**Use case'ler**
- `RegisterOrganization` (Faz 0 register flow'undan ayrı kullanım: mevcut owner ek org açar)
- `InviteMember(organizationId, email, role)` — pending davet açar (`OrganizationInvitation`), tek-seferlik token üretir, **7 gün geçerli**, davet email'i gönderir. Aynı email'e bekleyen davet varsa reddedilir (`CancelInvitation` çağrılmadıkça).
- `CancelInvitation(invitationId)` — admin/owner pending daveti iptal eder.
- `AcceptInvitation(token)` — token'ı doğrular, kullanıcının email'i ile davet email'inin eşleştiğini kontrol eder, `OrganizationMember` açar, davet kapatılır. Mevcut hesap akışı: login + onay; yeni kullanıcı akışı: register form'unda email pre-filled, register sonrası otomatik kabul.
- `UpdateMemberRole(memberId, newRole)` — owner rolüne dokunmaz, self-edit yasağına tabidir.
- `RemoveMember(memberId)` — soft-delete veya hard-delete (KISS: hard-delete, `creatorId` zaten `User` referansı; çıkarılan üyenin yarattığı `Prompt`/`Version`/`Benchmark` org'da kalır).
- `TransferOwnership(targetUserId)` — yalnız mevcut owner çağırır; UoW içinde iki rol değişimi atomik (mevcut owner → admin, target → owner).
- Her membership-değiştiren use case `OrganizationMembershipEvent` log'lar (eventType, actorUserId, targetUserId, oldRole?, newRole?, timestamp).

**Authorization katmanı**
- Authorization middleware: route declarative permission alır (`requirePermission("prompt:promote")`); middleware `currentOrganizationId`'yi (header veya URL'den) çözer, kullanıcının ilgili org'daki `OrganizationMember` row'unu yükler, rolünü permission map'e bakarak doğrular.
- Mevcut Prompt/Benchmark sorgularını organization filtresi ile sıkılaştır (defense-in-depth: repo seviyesinde her query `organizationId` zorunlu).

**Frontend**
- `organizations.atoms.ts`. Header'da **org switcher** (kullanıcı birden fazla org üyesiyse).
- **Org settings → Members** sayfası: üye tablosu (avatar / email / rol dropdown / son aktif / "Çıkar" butonu). Rol dropdown ve "Çıkar" sadece `admin`/`owner` için aktif; kendi satırında her ikisi disable. Owner satırında "Çıkar" yok, "Sahipliği devret" ayrı buton (sadece mevcut owner görür).
- **Org settings → Invitations** sekmesi: pending davetler listesi + "İptal" butonu + "Yeniden gönder" (token süresi dolmuşsa).
- "Üye davet et" modal: email + rol dropdown.
- **Davet kabul ekranı** (org-bağımsız route, login zorunlu): "X organizasyonuna katılmak ister misin?" onay + kabul/red.
- Üye satırında "Geçmiş" detay açılır penceresi (audit log: rol değişimleri, davet/çıkarma).

### Faz 1C — Production Approval Workflow (3-4 gün)
Bağımlılık: Faz 1B. **Yalnızca `→ production` geçişine uygulanır**; diğer aşama geçişleri (draft↔development↔staging ve geri yönler) etkilenmez.
- Domain: `ApprovalPolicy` (Organization VO/alt entity'si), `VersionApprovalRequest` aggregate.
- Use case'ler: `UpdateApprovalPolicy` (yalnız `admin`/`owner`), `RequestProductionApproval`, `ApproveVersion`, `RejectVersion`, `CancelApprovalRequest`. `approve` aynı kullanıcının tekrar oy vermesini reddeder; threshold dolunca otomatik `PromoteVersion(→production)` çağrılır (UoW içinde request resolve + version status atomik).
- `PromoteVersion` davranışı: **yalnızca production hedefli** istek geldiğinde organizasyonun `ApprovalPolicy`'si varsa direkt promote etmek yerine `VersionApprovalRequest` açar. Policy yoksa, `requiredApprovals=0` ise veya hedef status `production` dışında biri ise eski davranış (direkt promote).
- Frontend: pending approval listesi (`approver` rolüne göre filtreli), version detay'da approval status banner'ı + approve/reject butonları, in-app notification badge'i. Production butonu policy varsa "Onaya gönder" etiketine döner.

### Faz 1D — Version Comparison & Diff (2-3 gün)
Bağımlılık: Faz 1.
- Use case: `CompareVersions(promptId, versionA, versionB)` — read-only, query service üzerinden iki version'ın projection'ını çeker, alanları diff edip döner.
- Diff alanları:
  - **Classical body**: satır bazlı text diff (`diff` kütüphanesi veya basit longest-common-subsequence).
  - **Mermaid graph**: text diff (mermaid kodu satır bazlı). Daha sonra Faz 4B sonrası structural diff (eklenen/silinen node/edge) eklenebilir, başlangıçta text diff yeterli (KISS).
  - **Variables**: liste diff — eklenen, kaldırılan, default/description/required değişen.
  - **Benchmark metrics**: her iki version son benchmark'ında varsa accuracy/PPD/cost/latency yan yana.
- Frontend: prompt detay sayfasında "Compare" butonu → 2 version dropdown → side-by-side diff view (4 sekmeli: Body / Graph / Variables / Metrics). Same-prompt only — farklı prompt'ların version'ları kıyaslanamaz.
- Out of scope: 3+ version karşılaştırma (YAGNI), version delete (kapsam dışı).

### Faz 2 — AI Provider Adapter Katmanı (3-4 gün)
12. `IAIProvider` interface (generate, countTokens, getPricing).
13. OpenAI + Anthropic adapter implementasyonları.
14. Provider factory + model registry (model adı → provider + pricing).
15. Token cost hesaplama value object (`TokenCost.calculate(model, tokensIn, tokensOut)`).

### Faz 3 — BRAID Generation: Generator + Agent (1 hafta)
İki yol birlikte yaşar:
- **`BraidGenerator` (one-shot kısayol)** — paper §A.1 prompt'uyla classical → mermaid, tek call. "Tek tıkla üret" UX'i.
- **`BraidAgent` (iteratif chat)** — paper §A.4 kurallarına uygun graph üretmek/refine etmek üzere kurulmuş chat agent'ı. Stateless backend, persist edilen tek artifact = kullanıcı kaydederse açılan yeni `PromptVersion`.

Her iki yol da aynı `BraidAuthorship.byModel(...)` ile authorship işaretler.

#### 3.1 Generator (one-shot)
16. `BraidGenerator` service — paper Appendix A.1 prompt'unu temel al, task type'a göre varyantlar (math, creative, instruction-following). Çıktı: `{ graph }`. Generator prompt'u, **klasik prompt'taki variable referanslarını korumakla** açıkça yükümlendirilir: classical body'deki `{{varName}}` placeholder'ları graph node label'larında uygun aşamalarda **olduğu gibi** taşınır, generator bunları sabit string'e dönüştürmez.
17. Mermaid parser — generated output'u parse edip `BraidGraph` entity'sine çevir, syntax validation. Parser node label'larındaki `{{varName}}` referanslarını çıkartır; `GenerateBraid` use case bu set'in `PromptVersion.variables[]` ile tutarlı olmasını doğrular (yeni referans varsa parent'tan miras alınan variable listesine eklenir, kaldırılan variable referansı warning).
18. `GenerateBraid` use case — classical prompt + model → graph; fork-on-create yeni version açar. Variable listesi parent version'dan miras alınır.
19. **Graph cache** (Redis): key = `hash(classicalPrompt + generatorModel + taskType + variableNames)`, TTL uzun. Amortized cost için hit count track et. Variable adları cache key'e dahil çünkü farklı placeholder set'i farklı graph üretebilir.

#### 3.2 BRAID Chat Agent (iteratif)
**Kararlar:**
- **Stateless backend.** Her chat request'inde frontend full conversation history'yi POST eder; backend transcript'i DB'ye yazmaz, response sonrası unutur. LLM çağrısı history'nin tamamını alır → multi-turn context.
- **Conversation yaşam süresi frontend in-memory.** Jotai atom'ı, sayfa refresh → conversation gider. localStorage YOK. Kullanıcı uzun süre sonra geri dönmek istemez kabulüyle (kullanıcı tarafından doğrulandı).
- **Tek persist edilen artifact: diagram.** Agent her diagram önerisinin altında "Bu version'ı kaydet" butonu. Kullanıcı seçtiği öneriyi kaydeder → parent'ı conversation'ın başladığı version olan yeni `PromptVersion` (fork-on-save). Kullanıcı 3 farklı öneriden 2.'sini de seçebilir, her biri ayrı kaydedilebilir.
- **Cost UI'da gösterilmez.** (Kullanıcı tercihi.) Sadece kaydedilen diagram'ın o turn'deki token cost'u `PromptVersion.generationCost` meta'sına yazılır (audit).
- **Backend hard limit:** input ~30k token / ~50 mesaj. Aşıldığında 400. Frontend limit'e yaklaştığında uyarı banner'ı gösterir.
- **Per-user concurrency:** her kullanıcının kendi tarayıcısında kendi sohbeti vardır; persist olmadığı için "shared conversation" sorusu zaten anlamsız.
- **Agent context'i:** system prompt = paper §A.4 kuralları + mevcut version'ın source prompt'u + variable listesi + (varsa) mevcut mermaid + son linter skoru.
- **Linter feedback inline + "Düzelt" butonu:** her diagram önerisinin altında otomatik linter çalışır; chat'te tek satır özet ("Quality 78/100, atomicity zayıf — 2 warning") + tıklanabilir detay listesi (rule + node/edge ref + message). **Skor eşiğin altındaysa (default `<80`) veya en az bir warning/error varsa "Linter sorunlarını düzelt" butonu görünür**; tıklanınca findings structured olarak otomatik bir user message'a serialize edilir (örn. "Şu sorunları düzelterek graph'ı iyileştir: [rule=node-atomicity, node=N3, message=...]") ve aynı conversation içinde agent'a gönderilir. Bu otomatik mesaj kullanıcı history'sinde **görünür** (şeffaflık — kullanıcı agent'tan ne istendiğini bilir, gerekirse manuel müdahale eder). Kullanıcı dilerse butonu kullanmadan kendi yazdığı mesajla da iyileştirme isteyebilir.
- **Variable awareness:** agent variables[] listesini görür, node label önerilerinde `{{var}}` kullanır, yeni variable önerirse kullanıcı onayı sonrası kaydedilen version'ın `variables[]`'ına eklenir.
- **Model:** conversation başına sabit, conversation içinde değişmez.

- **Backend implementation:** mevcut `ChatBraidUseCase` ikiye ayrılır:
  - `BraidChat` (yeni use case): stateless. Input: `{ promptId, sourceVersionLabel, userMessage, history: ChatTurn[], model }`. Output: `{ type: "question", question } | { type: "diagram", mermaidCode, qualityScore, cost }`. **Persist etmez.** Hard limit kontrolü burada.
  - `SaveBraidFromChat` (yeni use case): kullanıcı "Bu version'ı kaydet" derse çağrılır. Input: `{ promptId, sourceVersionLabel, mermaidCode, generatorModel, generationCost }`. Fork-on-save. UoW içinde version + prompt root atomik.
- **Mevcut `ChatBraidUseCase` deprecate edilir** → iki yeni use case'e bölünür. Test ve presentation katmanı buna göre güncellenir.
- Frontend: prompt version detay'da "Chat ile düzenle" butonu → conversation paneli açılır. Sol: chat history (Jotai atom). Sağ: agent'ın önerdiği diagram render (Mermaid.js) + linter skoru + "Bu version'ı kaydet" butonu. Çoklu öneri: her önerinin kendi render+kaydet bloğu, history'de yukarı doğru kalır. SSE ile streaming response.
- Frontend: "Generate BRAID" (one-shot) butonu ayrı, side-by-side classical/braid view, generation state Jotai atom ile. Render edilen graph'ta `{{var}}` referansları ayrı renkte vurgulanır.

### Faz 4 — Graph Linter (4-5 gün)
Paper'daki 4 prensibin otomatik kontrolü:
21. **Node Atomicity Checker:** her node'un token sayısı <15 mi.
22. **Answer Leakage Detector:** node içinde literal çıktı var mı — regex + küçük LLM check.
23. **Verification Coverage:** terminal Check/Critic nodları var mı.
24. **Edge Determinism:** koşul etiketli edge oranı.
25. Her biri 0-100 skor, weighted `GraphQualityScore` value object.
26. Frontend: linter sonuçları panel, uyarılar inline.

### Faz 4B — Visual Graph Editor (1 hafta)
Bağımlılık: Faz 3, Faz 4. BRAID graph'ın render üzerinden manuel düzenlenmesi. Mevcut `UpdateBraidGraphUseCase` bütün graph'ı tek seferde fork ediyor; bu fazda **node-level edit** ve **structural edit** ayrı edit primitive'leri olarak gelir, yine fork-on-edit (her edit yeni version) prensibi korunur.
- **Edit primitive'leri** (her biri use case + endpoint):
  - `RenameBraidNode(versionId, nodeId, newLabel)` — node label'ı değişir; `{{varName}}` referansı eklenip çıkarılabilir.
  - `RepositionBraidNode(versionId, nodeId, x, y)` — sadece layout (Mermaid pozisyon tutmaz, layout için ayrı `BraidGraphLayout` value object'i: `{ nodeId, x, y }[]`. Mermaid kodu değişmez, pozisyon ayrı persist edilir).
  - `AddBraidNode(versionId, label, kind)`, `RemoveBraidNode(versionId, nodeId)` — graph topology değişimi, mermaid yeniden serialize edilir.
  - `AddBraidEdge(versionId, fromId, toId, label?)`, `RemoveBraidEdge(...)`, `RelabelBraidEdge(...)`.
  - `ReplaceBraidMermaid(versionId, mermaidCode)` — tam metin mod (mevcut `UpdateBraidGraphUseCase` bu primitive'in karşılığı).
- Tüm primitive'ler aynı fork-on-edit pattern'ine uyar: edit → yeni `PromptVersion` (parent linkli), `versionCounter` artar, status `draft`. Çoklu hızlı edit için frontend debounce + tek fork (Faz 4B v2'de optimize edilebilir; ilk sürüm her primitive yeni version).
- Domain: `BraidGraph`'a structural mutation metotları (`renameNode`, `addEdge`, …); mermaid serializer (`BraidGraph.toMermaid()`). Layout pozisyonları ayrı `versions.layouts[]` koleksiyonunda veya `PromptVersion.braidGraphLayout?` field'ında — versiyona bağlı, layout edit fork **yaratmaz** (sadece layout rename'inde fork yaratmak yerine inline update mantıklı; bunu YAGNI ile başlangıçta da fork-on-layout olarak tutup performans gözlemine göre revize edebiliriz).
- Frontend: ReactFlow (veya benzer node-edge editor kütüphanesi) ile graph render. Üç mod toggle:
  1. **Render mode** — sadece görüntüleme.
  2. **Visual edit mode** — node click → inline label input, drag → position, edge click → label edit, sağ-tık menü ile add/remove.
  3. **Text edit mode** — Monaco ile ham mermaid kodu, save → `ReplaceBraidMermaid`.
  Üç mod arasında geçiş state'i tutarlı: visual edit'ten text edit'e geçerken kaydedilmemiş değişiklik varsa kullanıcıya sorulur.
- Variable picker: edit modunda node label input'unda `{{` yazınca autocomplete `PromptVersion.variables[]` listesinden öneri açar, yeni variable adı yazılırsa version'ın variable listesine inline ekleme prompt'u çıkar.

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
    const client = new Plexus({ apiKey });
    // promptId + variables — ana kullanım şekli
    const result = await client.prompt("prompt-id").run({
      vars: { question: "...", context: "..." },
    });
    // veya pinli: "prompt-id@v3"
    ```
    SDK input shape'i `PromptVersion.variables[]`'tan türer; `shared-types` paketinde version başına generate edilen tip yerine **runtime'da** `vars: Record<string, string>` kabul edilir, server-side validation kontrol eder.
37. Version pinning: explicit (`prompt-id@v3`) veya implicit (default = production version). Production yoksa `404` — istem reddedilir, fallback yoktur.
38. Her `.run()` otomatik log → backend `/sdk/execute` endpoint → `ExecutionLog`. Log payload variable adlarını içerir, **değerleri PII riski nedeniyle hash'lenir veya redact edilir** (org seviyesinde policy: full|hash|redact, default `hash`).
39. **Server-side variable substitution + execution runtime**: `/sdk/execute` (a) version'ı yükler, (b) gelen `vars`'ı `PromptVersion.variables[]` ile doğrular (eksik required variable → 400; bilinmeyen variable → ignore + warning log; default'lar uygulanır), (c) classical body veya BRAID graph node label'larındaki `{{name}}` placeholder'larını substitute eder, (d) BRAID ise `BraidAgent` runtime'ı üzerinden execute, klasikse direkt solver'a gönderir, (e) sonucu stream'ler.
    - Substitution **literal string replace** — expression evaluation yok (injection güvenliği).
    - Substituted prompt log'a girer (yine PII policy uyarınca redact edilebilir).
40. Shadow mode: prod v3 çalışırken v4'ü arka planda paralel çalıştır (aynı `vars`'la), karşılaştır.
41. Retry + fallback (provider A fail → B).
42. SDK README + örnek usage (variable kullanımı dahil).

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
- **Multi-tenant isolation iki katmanlı:** (1) authorization middleware her request'te kullanıcının aktif organizasyonuna ait üyeliğini ve permission'ını kontrol eder; (2) repository sorguları her zaman `organizationId` ile filtrelenir — middleware atlasa bile repo başka org'un verisini dönmez. Defense-in-depth.
- **RBAC merkezi map** — rol → permission tablosu tek bir `permissions.ts` dosyasında. Endpoint'ler `requirePermission("...")` ile declarative işaretlenir, koşullu `if role === "admin"` kontrolü iş kodunda yasak.

  **Rol → permission matrisi** (Faz 1B implementasyonunun referansı):

  | Aksiyon | owner | admin | editor | approver | viewer |
  |---|:-:|:-:|:-:|:-:|:-:|
  | `org:settings:edit` (ad, policy) | ✓ | ✓ | – | – | – |
  | `org:delete` | ✓ | – | – | – | – |
  | `member:invite` / `member:role:update` / `member:remove` | ✓ | ✓ | – | – | – |
  | `ownership:transfer` | ✓ | – | – | – | – |
  | `policy:edit` (ApprovalPolicy) | ✓ | ✓ | – | – | – |
  | `prompt:create` / `prompt:edit` / `version:edit` | ✓ | ✓ | ✓ | – | – |
  | `prompt:promote` (her aşama) | ✓ | ✓ | ✓ | – | – |
  | `version:approve` (production approval oyu) | ✓ | ✓ | – | ✓ | – |
  | `prompt:read` / `version:read` / `benchmark:read` | ✓ | ✓ | ✓ | ✓ | ✓ |

  `approver` rolü kasıtlı olarak `prompt:edit`'e sahip DEĞİL — compliance/legal/lead gibi "yalnız onay veren" persona'lar için. `admin/owner` her şeyi yapabildiği için ayrıca `version:approve` izniyle de approval verebilir.

- **RBAC self-edit yasağı** — kullanıcı kendi `OrganizationMember` row'una mutasyon yapamaz (rol değiştiremez, kendini çıkaramaz). Domain seviyesinde invariant; use case `actorUserId === targetUserId` ise reddeder. Owner devri ayrı `TransferOwnership` use case'idir.

- **Tek owner invariant** — bir org'da daima tam bir `owner`. `UpdateMemberRole` `owner` rolüne dokunmaz; devir yalnız `TransferOwnership` ile, UoW içinde iki rol değişimi atomik. Owner kendini çıkaramaz; önce devretmeli.
- **Approval, PromoteVersion'a sızmaz** — `PromoteVersion` use case'i policy varsa request açar, threshold dolunca aynı use case'i tekrar tetikler. Approval policy'si olmayan org'larda davranış değişmez (geriye uyumlu).
- **Variable syntax sabit:** `{{varName}}` — Mustache benzeri literal placeholder. Expression evaluation, conditional, iteration yok (YAGNI; gelirse ayrı bir templating engine kararı). Substitution server-side, **literal string replace**, escape gerekmez çünkü değer prompt body'sine gömüldükten sonra yine LLM token'ı olur — ama log/redaction politikası ayrıca uygulanır.
- **Variable bütünlüğü use case seviyesinde validate edilir, aggregate'te değil** — body parse + variable diff sentinel iş application layer'ında. `PromptVersion` aggregate'i variable listesini ve mermaid'i tutar; "her referans tanımlı mı" gibi cross-field kuralı use case'in input validation'ında. (Domain'in saf kalması için.)
- **Fork-on-edit korunur, primitive'ler eklenir** — visual editor her atomik mutation için yeni version açar (mevcut prensip). Layout-only değişimleri fork yaratmaz çünkü içerik aynı; bu istisna açıkça `BraidGraphLayout`'un version'a bağlı ama mutable bir alan olduğu kararıyla işaretlenir.
- **SDK interface promptId + vars'a sabitlenir**, type-safe per-prompt SDK üretimi (OpenAPI/codegen ile) ileri faz konusudur — başlangıçta runtime validation yeterli, type-safety henüz eklenmez.
- **BRAID chat conversation persist edilmez.** Backend stateless: history her request'te frontend'den full gelir, transcript DB'ye yazılmaz. Persist edilen tek artifact, kullanıcının kaydetmeyi seçtiği diagram'dan açılan yeni `PromptVersion`'dır. Bu karar conversation aggregate'i, transcript audit trail'ı ve ilgili RBAC'ı domain'e taşımayı (YAGNI) açıkça reddeder; Faz 9 "Improvement Suggestions" job'u kaydedilmiş version'lar üzerinden çalışır, transcript üzerinden değil.
- **4-stage workflow + production-only approval.** `VersionStatus = draft | development | staging | production`. `draft`'a geri dönüş yasak (mevcut domain kuralı), diğer geçişler iki yönlü serbest. Approval workflow **yalnız `→ production` geçişine** bağlanır; aşama başına ayrı permission yok, tek `prompt:promote` her geçiş için yeterli.
- **Version diff text-bazlı, structural diff sonra.** Faz 1D mermaid'i satır bazlı text diff ile gösterir. Structural diff (eklenen/silinen node/edge) Faz 4B (visual editor) sonrasında, ihtiyaç doğunca eklenir.

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
| Multi-tenant veri sızıntısı | Repo sorgularında `organizationId` zorunlu; integration testlerde "başka org user'ı X org'unun prompt'unu göremez" senaryosu kritik akış olarak dahil. |
| RBAC drift / kontrol unutmak | Tüm yetki kontrolü declarative middleware üzerinden; CI'da rota → permission haritası test edilir, yetkisiz route şikayet eder. |
| Approval threshold race (iki approver aynı anda son onayı verir) | UoW içinde request güncellemesi + auto-promote; threshold kontrolü güncellenen request'in son hâli üzerinden yapılır, aynı user'ın çift oyu reddedilir. |
| Visual editor ↔ text editor sync drift (fork-on-edit zinciri patlaması) | Edit primitive'leri atomik fork açar; UI tarafında "draft mode" toplu edit + tek explicit save → tek fork (bu Faz 4B v2 optimizasyonu). İlk sürümde her mutation fork'u kullanıcıya görünürdür. |
| Variable injection / log'dan PII sızıntısı | Substitution literal replace, expression yok. Variable değerleri ExecutionLog'a girerken org policy'sine göre `hash`/`redact`/`full` — default `hash`. PII tespiti dataset masking helper'ı (Faz 5) ile paylaşılan utility. |
| SDK breaking change (variable rename → eski caller'lar bozulur) | Variable rename yeni version açar, eski version'da eski isim çalışmaya devam eder; SDK explicit pinli kullanımda etkilenmez, `@production` kullanımında approval flow promotion'u zaten "kasıtlı" geçişi temsil eder. |
| BRAID chat conversation kaybı (sayfa refresh / hard limit aşımı) | Beklenti açıkça yönetilir: UI'da "Sohbet kaydedilmez, kaydetmek istediğin diagram önerisini 'Kaydet' ile version'a çevir" notu sürekli görünür. Hard limit'e (~30k token / 50 mesaj) yaklaşırken uyarı banner'ı; kullanıcı limit'e gelmeden iyi bir öneriyi kaydetmeye yönlendirilir. |
| 4-stage workflow geçiş yanlışlıkları (production'dan staging'e geri çekme) | Geri yönlü promote `prompt:promote` permission'ıyla serbest; production'dan geri çekmek "incident response" akışı sayılır, audit log'a yazılır. Approval policy yalnız ileri yönlü production geçişinde devreye girer, geri çekme onay gerektirmez. |

## 8. Tahmini Süre

Tek developer, full-time: **~12-14 hafta** MVP'ye.
- Faz 0-1 + 1B + 1C + 1D ~3 hafta. Faz 1 4-stage workflow için yarım gün ek; Faz 1B davet/audit/self-edit invariant'ları ile 5-6 güne çıktı; Faz 1D (diff view) ~2-3 gün.
- Faz 2-4 + 4B core graph + visual editor ~3.5 hafta (Faz 4B yeni: ~1 hafta).
- Faz 3'te `BraidChat` + `SaveBraidFromChat` ayrımı + linter feedback inline + variable awareness ek olarak ~1-2 gün getirir, Faz 3 toplamı ~1 hafta seviyesinde kalır.
- Faz 5-6 dataset + benchmark + dashboard ~2 hafta.
- Faz 7-8 SDK + public agent ~2 hafta (SDK'da variable substitution server-side genişletildi, +2-3 gün).
- Faz 9-10 analiz + deploy ~2 hafta.

Mevcut tamamlanma yüzdesi yeni kapsam (org + RBAC + approval + variables + visual editor + 4-stage + diff) eklendiği için **%40-50**'ye geriler — yapılan iş aynı, hedef büyüdü.

---

Başlamak için ilk somut adım: monorepo kurulumu + Clean Architecture iskeletini tek bir prompt CRUD üzerinden uçtan uca çalıştırmak (Faz 0 + Faz 1'in minimal dilimi). Bu walking skeleton sonra her yeni entity için şablon olur.
