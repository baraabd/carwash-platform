# Carwash Platform — Microservices Foundation 0.1

هذه حزمة تأسيس جديدة، وليست إصدارًا جاهزًا للعملاء. لم يُعدّل مستودع الخدمات المنزلية، ولم يُنشأ مستودع GitHub أو يُنفذ push/deploy.

## ابدأ من هنا

المخطط العربي في `docs/ARCHITECTURE_AR.md`، وقرار كل مكتبة في `docs/LIBRARY_ADOPTION_AR.md`، ونتائج الفحص في `docs/VERIFICATION.md`. خريطة الخدمات المقروءة آليًا في `architecture/service-catalog.json`.

الحزمة تشمل عشرة قوالب NestJS مستقلة ذات فحوص حياة فقط. جاهزيتها تعيد 503 عمدًا. تشمل أيضًا نواة تسعير وحالات حجز وفحص توازن قيد مالي وعقد حدث، و55 اختبارًا محدودًا. تلك النواة ليست تسجيل دخول أو حجزًا محفوظًا أو محرك دفع.

## تجربة الاختبارات المرفقة دون تثبيت مكتبات

تضم الحزمة ملفات JavaScript مولدة في `dist/` لكي تعمل الاختبارات دون تنزيل حزم. استعمل Node24 LTS على جهازك، وافتح الطرفية داخل مجلد carwash-platform:

```powershell
node --version
node --test tests/domain.test.mjs tests/boundaries.test.mjs
node scripts/check-boundaries.mjs
```

تشغيل هذين الأمرين لا يشغل الواجهات أو NestJS أو PostgreSQL أو RabbitMQ. الأدلة المرفقة أُنتجت على Node22.16.0 وTypeScript5.8.3 المتاحين في بيئة الفحص؛ الهدف Node24/TypeScript5.9.3 لم يُختبر هنا.

## تثبيت بيئة التطوير وإعادة البناء

على جهاز متصل بالإنترنت ومع pnpm10.32.1 وNode24، يحتاج Sprint0.2 إلى حل الاعتمادات وتوليد `pnpm-lock.yaml` أولًا. لا يوجد lockfile مُختلق في هذه الحزمة. يجب مراجعة التوافق والنتائج الأمنية قبل اعتماد النسخ.

```powershell
pnpm install
pnpm build:domain
pnpm test:domain
pnpm check:boundaries
```

بعد تثبيت Lockfile حقيقي ومراجعته تستخدم بوابات CI `pnpm install --frozen-lockfile`. `build:domain` يجمع النواة فقط؛ ليس بناءً كاملًا للخدمات أو الواجهات. بناء قوالب Nest يتم لكل خدمة عبر `pnpm --filter @carwash/identity build` وهكذا، ولا تعني استجابة فحص الحياة اكتمال الدومين.

## بنية التطوير الاختيارية

تحتاج Docker Desktop يعمل. الإعدادات مخصصة لبيانات تجريبية جديدة، ولا تمس منافذ أو قواعد المشروع السابق:

```powershell
node scripts/create-dev-env.mjs
docker compose --env-file .env.local -f infra/compose.dev.yml up -d
```

المنافذ المحلية: PostgreSQL55432، Redis56379، RabbitMQ5673، ولوحة إدارته15673. تظل مربوطة بـ127.0.0.1. لا تنشر هذه الإعدادات على الإنترنت. لا تشارك `.env.local`. توليد البيئة لا يستبدل ملفًا موجودًا. تهيئة PostgreSQL تعمل عند إنشاء volume جديد فقط؛ لا تحذف بيانات موجودة لمعالجة خطأ تهيئة.

هذا الأمر يشغل بنية بيانات فقط، وليس التطبيق. حساب RabbitMQ الأولي يحتاج استبدالًا بهويات خدمات وصلاحيات دقيقة في Sprint0.2. الصور ذات الوسم الرئيسي ليست Pins إنتاجية. اقرأ `infra/README.md`.

## ترتيب العمل التالي

الخطوة المحددة هي `docs/SPRINT_00_2_IMPLEMENTATION_PROMPT.md`: تثبيت الاعتمادات وبناء القوالب وإثبات عزل قواعد البيانات وهوية الرسائل واختبار Outbox/Inbox قبل تطوير تجربة الحجز الكاملة. لا توجد حاجة إلى نقل كل مكتبات الواجهة أو تقسيم كل جدول إلى خدمة.
