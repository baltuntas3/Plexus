# CLAUDE.md — Plexus Development Guide

Bu dosya Claude Code için proje-özel kurallardır. Her oturumda otomatik yüklenir. **Bu kurallara uymak zorunludur.**

## Proje Özeti

Plexus, LLM prompt'larını versiyonlayıp karşılaştırmak için geliştirilmiş bir prompt experimentation platformudur. Platforma kayıt olan birim **Organization**'dır; her organizasyon kendi içine kullanıcı davet eder ve roller (RBAC: `owner | admin | editor | approver | viewer`) atayarak yetkilendirme kurar. Kullanıcı, ait olduğu organizasyonun scope'unda prompt oluşturur, prompt'un birden fazla `PromptVersion`'ını yönetir (sıfırdan veya başka bir version'dan fork). Her version `draft → development → staging → production` workflow'undan geçer (4 aşama, `draft`'a geri dönüş yasak); production'a geçiş, organizasyon seviyesinde tanımlı opsiyonel bir `ApprovalPolicy`'ye tabi olabilir (örn. üç yetkili onayı sonrası otomatik promote). Diğer aşama geçişleri direkt `prompt:promote` permission'ıyla yapılır.

Her version klasik prompt içerir; istenirse bundan, paper §A.4 kurallarına uygun graph üretmek üzere kurulmuş **BRAID Chat Agent** ile chat akışında BRAID graph üretilir/refine edilir veya render üzerinden manuel düzenlenir (node label edit, drag-drop layout, mermaid text mode). BRAID Chat Agent **backend'de stateless**: conversation persist edilmez, frontend her request'te full history gönderir, persist edilen tek artifact kullanıcının "kaydet" dediği diagram'dan açılan yeni `PromptVersion`'dır. Hem klasik prompt'a hem de BRAID node label'larına `{{variableName}}` formatında **template variable**'lar gömülür; SDK çağrısında `(promptId, vars)` ile sunucu tarafında literal substitute edilir. Üretilen graph lint edilir, yapısal kalite skoru çıkarılır ve seçilen prompt version'ları seçilen solver modeller üzerinde benchmark'a sokulur. Aynı prompt'un iki version'ı side-by-side karşılaştırılabilir (body / graph / variables / metrics diff). Sistem test case üretir, cevapları toplar, judge modellerle puanlar, maliyet/latency/score hesaplar ve sonuç ekranında PPD (Performance-per-Dollar), Pareto frontier ve recommendation analizleri gösterir.

Referans: `braid.pdf` (Amcalar & Cinar, 2025). Mimari ve faz planı: `PLEXUS_PLATFORM_PLAN.md`. Plan hedef mimariyi, mevcut kod ise uygulanmış gerçek durumu gösterir. Çelişki varsa önce mevcut kodu doğrula, sonra kullanıcıya sor.

## Monorepo Yapısı

```
apps/
  backend/    @plexus/backend    Express + TS + MongoDB + in-process queue
  frontend/   @plexus/frontend   React + Vite + Mantine + Jotai
packages/
  sdk/            @plexus/sdk            TypeScript SDK
  shared-types/   @plexus/shared-types   Backend ↔ SDK ↔ Frontend tip paylaşımı
```

pnpm workspaces kullanılır. Paket eklerken `pnpm --filter @plexus/<name> add <pkg>`. Asla root'a uygulama bağımlılığı ekleme.

## Teknoloji Kısıtları (KATI)

**Kullanılacak:**
- Backend: Express, Mongoose, Zod, Jest, pino. Cache şu an in-memory (`InMemoryCacheStore`) ve queue şu an single-process (`InProcessJobQueue`); ikisi de `ICacheStore` / `IJobQueue` abstraction'ı ardında. Redis + BullMQ ertelendi, ihtiyaç doğduğunda swap edilir.
- Frontend: Mantine, **Jotai** (state), React Router, Mermaid.js, Recharts, Monaco
- SDK: Zero runtime deps dışında sadece `@plexus/shared-types`
- AI: Mevcut runtime Groq provider üzerinden çalışıyor; provider-agnostic `IAIProvider` interface korunur. Yeni provider eklenirse concrete client application/domain katmanına sızdırılmaz.

**Kullanılmayacak:**
- TanStack Query — server state Jotai async atom + refresh counter pattern ile
- Zustand, Redux, MobX — sadece Jotai
- Axios — native `fetch` yeterli
- Prisma — Mongoose
- Yup, Joi — sadece Zod
- Python — tüm stack TypeScript
- Tailwind — sadece Mantine

Yeni bağımlılık eklemeden önce **kullanıcıya sor**. "Bu iş için X paketi lazım" gibi spekülatif eklemeler yapma.

## Tasarım Prensipleri (ZORUNLU)

Üretilen **her kod parçası ve her yeni özellik** aşağıdaki prensiplere uymak zorundadır. Kod review'ında bunlardan biri ihlal ediliyorsa değişiklik reddedilir.

### SOLID
- **S — Single Responsibility:** Bir sınıf/fonksiyon/modül tek bir değişme nedenine sahip olmalı. Use case'ler tek `execute()`, servisler tek sorumluluk. "Ve" ile tarif ediliyorsa böl.
- **O — Open/Closed:** Yeni AI provider, yeni task type, yeni linter kuralı eklemek **var olan kodu değiştirmeden** mümkün olmalı. Strateji pattern, registry, adapter kullan. `switch(providerName)` zinciri yasak.
- **L — Liskov Substitution:** `IAIProvider`, `IPromptRepository` gibi interface'lerin her implementasyonu, tüketen kodu bozmadan yerine konulabilmeli. Alt sınıfta "bu metot desteklenmiyor" fırlatma.
- **I — Interface Segregation:** Kullanıcıya kullanmadığı metot dayatma. `IAIProvider` `generate`, `countTokens`, `getPricing` gibi ayrı küçük yetenekler halinde. Tek dev "god interface" yasak.
- **D — Dependency Inversion:** Yüksek seviye modüller (application/use-case) düşük seviye modüllere (Mongoose, OpenAI) **bağımlı olmaz** — ikisi de abstraction'a bağımlı. Concrete tip import etme, interface import et. Constructor injection zorunlu.

### DRY (Don't Repeat Yourself)
- Aynı mantık iki yerde varsa **üçüncüde ortaya çıkmadan** ortak yere çıkar.
- Tip tekrarı yasak: backend, frontend, sdk aynı şeyi anlatıyorsa `@plexus/shared-types`'a taşı.
- Zod şemasından `z.infer` ile tip türet — manuel eşlek yazma.
- Magic string/number yasak — `constants.ts` veya enum.
- **Dikkat:** Yanlış DRY daha kötüdür. Görünürde benzer ama farklı değişme nedenlerine sahip iki şey zorla birleştirilmez (bkz. SRP). Önce iki kez yaz, üçüncüsünde soyutla.

### KISS (Keep It Simple, Stupid)
- Çözüm anlaşılması için beyin jimnastiği gerektiriyorsa **yanlış çözümdür**. Basitleştir.
- Fancy TypeScript (derin conditional types, recursive mapped types) gereksiz yere kullanılmaz. Okunabilirlik tip zekasından önce gelir.
- 3 satırlık bir if yerine 5 katmanlı strategy pattern kurma. Soyutlama **ihtiyaç doğduğunda** gelir.
- Kütüphane eklemek yerine 10 satırlık utility yazılabiliyorsa ikincisi tercih edilir.

### YAGNI (You Aren't Gonna Need It)
- "İleride lazım olur" diye kod yazma. Gelecek gereksinim geldiğinde yaz.
- Kullanılmayan parametre, opsiyonel alan, "future proof" flag yasak.
- Generic bir sınıfı tek kullanım için açma. İkinci kullanım gelince generic'leştir.
- Configuration option eklemeden önce "buna şu an gerçekten ihtiyaç var mı?" sorusu geçilmeli.
- Feature flag, backward-compat shim, soyut base sınıf — hepsi talep olmadan yasak.

### Prensipler Çatıştığında
Öncelik sırası: **YAGNI > KISS > DRY > SOLID'in katı uygulanışı.** Yani YAGNI bir soyutlamayı yasaklıyorsa SOLID adına yine de ekleme. SOLID bir "belki gelecekte" gerekçesiyle değil, **şu an var olan gerçek bir değişim ekseni** ile gerekçelendirilir.

## Clean Architecture Kuralları (Backend)

Katman bağımlılığı **dışarıdan içeriye**:

```
presentation → application → domain
                      ↑
              infrastructure
```

- `domain/` — saf TS, hiçbir import yok (framework, ORM, HTTP). Sadece entity, value object, repository interface.
- `application/` — use case'ler, servisler, DTO. Sadece `domain` import eder.
- `infrastructure/` — Mongoose, cache/queue implementasyonları ve concrete AI provider client'ları. Repository/service interface'lerini implement eder; domain infrastructure'a bağımlı değildir.
- `presentation/` — Express controller/route. Use case çağırır, domain/infrastructure'a doğrudan dokunmaz.

**İhlal örneği:** Domain entity'sinde `import mongoose from 'mongoose'` → YANLIŞ. Mongoose şeması `infrastructure/persistence/` içinde tutulur, domain entity ayrı POJO olarak kalır.

Her use case tek bir sorumluluk, tek `execute()` metodu, kendi input/output DTO'su.

## Mevcut Ürün Durumu

Tamamlanmış veya büyük ölçüde çalışan çekirdek akışlar:
- Auth, protected frontend layout, prompt listesi ve prompt detail akışı.
- Prompt version oluşturma, isimlendirme, draft/staging/production durum geçişleri.
- BRAID generation, Mermaid parse/validation, graph render, chat ile graph üretme/refine etme.
- Graph linter ve `GraphQualityScore` paneli.
- Benchmark oluşturma, generated/manual test case düzenleme, in-process job ile benchmark başlatma, SSE progress stream.
- LLM judge skorlama, verbosity penalty, cost/latency/token kayıtları.
- Benchmark analysis: PPD, Pareto frontier, confidence interval, composite ranking ve recommendation.

Eksik veya plan seviyesinde kalan büyük bloklar:
- **Organization & üyelik (multi-tenant):** `Organization`, `OrganizationMember` entity'leri, davet/rol değişimi akışı; mevcut tüm aggregate'lerin (`Prompt`, `PromptVersion`, `Benchmark`, `Dataset`) `organizationId` ile scope'lanması; repo seviyesinde org filtresi (defense-in-depth).
- **RBAC:** sabit rol enum (`owner | admin | editor | approver | viewer`) + tek `permissions.ts`'de rol→permission map; declarative `requirePermission(...)` middleware. `switch(role)` kontrolü iş kodunda yasak. **Invariant'lar:** (a) self-edit yasağı — kullanıcı kendi membership row'unu değiştiremez/çıkaramaz, (b) tek owner — `UpdateMemberRole` `owner` rolüne dokunmaz, devir yalnız `TransferOwnership` ile (UoW atomik), (c) owner kendini çıkaramaz, önce devretmeli. Üye değişimleri `OrganizationMembershipEvent` audit log'una yazılır.
- **Approval workflow:** opsiyonel `ApprovalPolicy` (organization VO/alt entity'si) + `VersionApprovalRequest` aggregate. **Yalnız `→ production` geçişine** uygulanır; threshold dolunca otomatik `PromoteVersion(→production)` (UoW içinde request resolve + version status atomik).
- **4-stage workflow migration:** `VersionStatus` enum `"draft" | "staging" | "production"` → `"draft" | "development" | "staging" | "production"`. `shared-types`, domain, mongoose, frontend dropdown'ları senkron güncellenir. `draft`'a geri dönüş yasağı korunur.
- **Template variables:** `PromptVersion.variables[]` (`PromptVariable` VO listesi: `name | description? | defaultValue? | required`). Klasik body ve braid node label'larında `{{name}}` referansları parse edilir; bütünlük (tanımlı↔referans) **use case seviyesinde** doğrulanır, aggregate'te değil. Substitution server-side (literal replace, expression yok).
- **BRAID Chat Agent ayrımı:** mevcut `ChatBraidUseCase` ikiye bölünür — `BraidChat` (stateless, persist etmez, hard limit ~30k token / ~50 mesaj) + `SaveBraidFromChat` (kullanıcı "kaydet" derse fork-on-save). Conversation transcript'i domain entity DEĞİL, persist edilmez. Linter feedback chat'te inline + "Düzelt" butonu (skor `<80` veya warning/error varsa) findings'i structured user message'a serialize edip agent'a gönderir.
- **Visual graph editor:** render üzerinde node-level edit primitive'leri (`RenameBraidNode`, `RepositionBraidNode`, `AddBraidNode`, `RemoveBraidNode`, `AddBraidEdge`, …), text mode mermaid + visual mode senkron. ReactFlow benzeri kütüphane gerekir, henüz onaylanmadı — eklemeden önce sor. Layout-only değişimler fork yaratmaz; structural mutation'lar fork-on-edit.
- **Version comparison & diff:** `CompareVersions` use case + 4 sekmeli side-by-side UI (Body / Graph / Variables / Metrics). Mermaid diff başlangıçta text bazlı, structural diff sonra.
- `packages/sdk` runtime API'si: `client.prompt(id).run({ vars: {...} })`. `/sdk/execute`, `ExecutionLog`, server-side variable substitution + validation, production execution runtime.
- Public `Agent` entity/endpoints (BRAID Chat Agent'tan farklı: bu public API agent'ı), API key yönetimi, usage quota/rate limit dashboard.
- Ayrı `Dataset` CRUD, CSV/JSON import ve numerical masking helper.
- Redis/BullMQ production queue/cache implementasyonları.
- Production traces viewer, periodic improvement suggestions, OpenAPI/Swagger, Playwright E2E, CI/CD ve deploy otomasyonu.

## Halüsinasyon Önleme Kuralları

Bunlar **davranışsal kurallar**, yoruma açık değildir.

### 1. Var olmayan dosya/fonksiyon/paket uydurma
Bir dosyayı, fonksiyonu, API endpoint'ini veya paketi **referans vermeden önce doğrula**:
- Dosya için: `Read` veya `Glob`
- Sembol için: `Grep`
- Paket için: `apps/*/package.json` veya `packages/*/package.json` içinde var mı bak

"Muhtemelen şu dosyada vardır" deme. Bilmiyorsan ara. Bulamazsan kullanıcıya söyle.

### 2. API imzası tahmini yapma
Bir kütüphanenin (Mongoose, Mantine, Jotai, BullMQ, OpenAI SDK) API'sinden emin değilsen **WebFetch ile resmi doküman oku** veya `node_modules/<pkg>/dist/*.d.ts` dosyasını `Read` ile incele. Ezberden API yazıp hata yaptığını umma.

### 3. Tip uydurma
`shared-types` paketinde olmayan bir tipi "varmış gibi" kullanma. Önce `packages/shared-types/src/` altına ekle, sonra kullan.

### 4. Varsayımla refactor
"Bunun eski kullanımları da güncellenmeli" diyorsan önce `Grep` ile tüm call site'ları bul. Listele. Sonra düzenle. Kör toplu değişiklik yasak.

### 5. Test uydurma
Var olmayan test util'leri import etme. Yeni bir mock/fixture gerekiyorsa önce oluştur, sonra kullan.

### 6. "Çalışıyor olmalı" cümlesi yasak
Kod yazdıktan sonra **çalıştır veya derle**:
- Backend: `pnpm --filter @plexus/backend build` veya ilgili test
- Frontend: `pnpm --filter @plexus/frontend build`
- Tip kontrolü: `tsc --noEmit`

Kullanıcıya "şimdi çalışmalı" yerine "build geçti" / "şu test başarılı" de.

### 7. Belirsizliği sakla
Üç veya daha fazla makul yorum varsa **bir tanesini seçme, sor**. Örn: "Bu endpoint'i `/prompts/:id/versions` mı yoksa `/versions?promptId=` mı yapayım?"

## Kod Konvansiyonları

- **TypeScript strict mode** — `strict: true`, `noUncheckedIndexedAccess: true`. `any` yasak, kaçınılmazsa `unknown` + narrow.
- **Named exports** — default export yok (React component dosyaları hariç değil, onlar da named).
- **Dosya adları** — `kebab-case.ts`. Entity sınıfları `PascalCase` içerikte.
- **Async her zaman** — callback yok, sadece `async/await`.
- **Zod her boundary'de** — HTTP input, SDK input, env var parsing. `z.infer` ile tip türet, elle yazma.
- **Error handling** — domain'de `Result<T, E>` pattern veya custom `DomainError` sınıfları. HTTP katmanında tek `errorHandler` middleware'de çevir.
- **Yorum politikası** — WHAT yazma, WHY yaz. Kod kendi kendini anlatıyorsa yorum ekleme. JSDoc sadece public API'lerde (SDK).
- **Dosya boyutu** — bir dosya 300 satırı geçerse böl.

## Jotai Konvansiyonları (Frontend)

- Atom'lar `src/atoms/` altında feature bazlı dosyalarda.
- Async read atom + mutation write atom + refresh counter triadı standart pattern.
- `atomWithStorage` sadece auth ve UI tercihleri için.
- Component içinde inline atom yaratma — Provider seviyesinde yönetilemez state kaçağı yaratır.
- `useAtom`, `useAtomValue`, `useSetAtom` — mümkün olan en dar olanı seç.

## Git & Commit

- Commit mesajı: conventional commits (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`).
- Bir commit tek bir mantıksal değişiklik. Otomatik format düzeltmeleri ayrı commit.
- `main` branch'ine direkt commit yok — feature branch + PR.
- Commit'i **kullanıcı açıkça isteyene kadar** yapma.

## Test Stratejisi

- **Domain ve application** — unit test, %80+ coverage hedef. Infrastructure mock'lanır.
- **Infrastructure** — integration test (real MongoDB via docker-compose; Redis/BullMQ eklendiğinde ayrıca real service testleri).
- **Presentation** — supertest ile HTTP seviyesinde.
- **Frontend** — Vitest + React Testing Library, kritik akışlar (prompt create, benchmark run) e2e.
- Yeni use case yazıldığında **aynı commit'te** testi de gelir. Test'siz use case merge edilmez.

## BRAID-Özel Kurallar

- BRAID generation prompt'u (one-shot `BraidGenerator`) `braid.pdf` Appendix A.1'e **birebir** uygun başlar. Varyasyonlar `application/services/braid/prompts/` altında task type başına bir dosya.
- **BRAID Chat Agent system prompt'u**, paper §A.4'teki 4 prensibi (atomicity, no leakage, deterministic edges, terminal verification) açıkça yazar + mevcut version'ın source prompt'u + `variables[]` listesi + (varsa) mevcut mermaid + son linter skoru ile composer edilir. Agent var olan kuralları "yorumlamaya" değil **uygulamaya** zorlanır.
- **BRAID Chat Agent backend stateless'tır.** Conversation transcript domain entity değildir, DB'ye yazılmaz. Frontend her request'te full history gönderir. `BraidChat` use case'i **persist etmez**; persist eden tek operasyon `SaveBraidFromChat` (kullanıcı "kaydet" der → fork-on-save).
- Klasik body veya braid node label'larındaki `{{varName}}` referansları **literal placeholder**'dır; generator/agent bunları sabit string'e dönüştürmemekle yükümlü. Mermaid parser bu referansları structurally bilir (atomicity sayımında token olarak dahil etmez).
- Graph linter kuralları paper A.4'teki 4 prensibi **olduğu gibi** uygular:
  1. Node Atomicity (<15 token)
  2. No Answer Leakage
  3. Deterministic Branching (labeled edges)
  4. Terminal Verification Loops
- PPD formülü (`braid.pdf` eq. 4) value object olarak implement edilir, inline hesaplama yok.
- Numerical masking (paper §4) math dataset'leri için planlanan helper'dır; ayrı dataset modülü eklendiğinde domain/application seviyesinde uygulanır.

## Yapılmayacaklar Listesi

- README veya doküman dosyası oluşturma — kullanıcı istemedikçe.
- "Gelecekte lazım olur" diye abstraction ekleme.
- Kullanılmayan import/dosya bırakma.
- `console.log` bırakma — pino logger kullan.
- Hardcoded secret — `.env` + Zod ile parse.
- Her yere try/catch serpme — sadece gerçek boundary'lerde.
- Feature flag / backward compat shim — erken refactor yasağı da dahil, gereksiz karmaşıklık eklemek yasak.
- Emoji — kullanıcı açıkça istemedikçe kod veya dokümanda kullanılmaz.

## Belirsizlikte Varsayılan Davranış

Emin değilsen:
1. Mevcut kodu oku (`Read`, `Grep`, `Glob`).
2. `braid.pdf` ve `PLEXUS_PLATFORM_PLAN.md` ile çelişiyor mu kontrol et.
3. Hâlâ belirsizse **kullanıcıya tek cümlelik somut bir soru sor**, varsayımla ilerleme.
