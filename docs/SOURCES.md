# مصادر القرار وحدود الأدلة

تاريخ القراءة: 19 سبتمبر 2026. روابط المستودع مثبتة على نسخة واحدة، ولا تشير إلى فرع متغير. ملفات الحزم قوائم اعتمادات وليست إثبات تثبيت أو أمان. أعدنا قراءة بيانات الفرع وملفي حزم الواجهة والخادم وملف حدود المال في هذه الجولة. بقية خريطة إعادة الاستخدام مستندة إلى الجرد السابق الموجود في المحادثة؛ لم نكرر تدقيق كامل المستودع.

| ID | المصدر | الغرض |
|---|---|---|
| R1 | [GitHub commit 66e6d936](https://github.com/baraabd/homeservicemarketplace/commit/66e6d93682dcdf6e5dd198c313f21f638dafe8de) | تثبيت نسخة المرجع |
| R2 | [Backend manifest](https://github.com/baraabd/homeservicemarketplace/blob/66e6d93682dcdf6e5dd198c313f21f638dafe8de/apps/api/package.json) | مكتبات الخادم المعلنة |
| R3 | [Frontend manifest](https://github.com/baraabd/homeservicemarketplace/blob/66e6d93682dcdf6e5dd198c313f21f638dafe8de/apps/web/package.json) | مكتبات الواجهة وRadix والاختبارات |
| R4 | [Money implementation status](https://github.com/baraabd/homeservicemarketplace/blob/66e6d93682dcdf6e5dd198c313f21f638dafe8de/docs/money/IMPLEMENTATION_STATUS.md) | حدود التنفيذ المالي |
| R5 | [AppModule](https://github.com/baraabd/homeservicemarketplace/blob/66e6d93682dcdf6e5dd198c313f21f638dafe8de/apps/api/src/app.module.ts) | مرجع الربط من الجرد السابق |
| R6 | [Provider module](https://github.com/baraabd/homeservicemarketplace/blob/66e6d93682dcdf6e5dd198c313f21f638dafe8de/apps/api/src/modules/provider/provider.module.ts) | مرجع وظائف المهني من الجرد السابق |
| R7 | [Admin module](https://github.com/baraabd/homeservicemarketplace/blob/66e6d93682dcdf6e5dd198c313f21f638dafe8de/apps/api/src/modules/admin/admin.module.ts) | مرجع وظائف الأدمن من الجرد السابق |
| R8 | [UX/UI design system](https://github.com/baraabd/homeservicemarketplace/blob/66e6d93682dcdf6e5dd198c313f21f638dafe8de/docs/provider-experience-v2/UX_UI_DESIGN_SYSTEM.md) | مرجع أنماط التصميم من الجرد السابق |
| R9 | [CI](https://github.com/baraabd/homeservicemarketplace/blob/66e6d93682dcdf6e5dd198c313f21f638dafe8de/.github/workflows/ci.yml) | خريطة الاختبارات من الجرد السابق، لا نتائجها |
| W1 | [Node.js releases](https://nodejs.org/en/about/previous-releases) | اختيار Node24 LTS بدل Node20 المنتهي الدعم |
| W2 | [Microsoft: Data sovereignty per microservice](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/architect-microservice-container-applications/data-sovereignty-per-microservice) | استقلال ملكية البيانات والعقود |
| W3 | [NestJS: RabbitMQ](https://docs.nestjs.com/microservices/rabbitmq) | موصل RMQ ومكتباته والتأكيد اليدوي |
| W4 | [RabbitMQ: Reliability](https://www.rabbitmq.com/docs/reliability) | تأكيد التسليم والفشل والتكرار |
| W5 | [OWASP: Microservices security](https://cheatsheetseries.owasp.org/cheatsheets/Microservices_Security_Cheat_Sheet.html) | هوية الخدمات والتصريح وحماية الاتصال |
| W6 | [Stripe: Webhooks](https://docs.stripe.com/webhooks) | التوقيع والأحداث المتكررة؛ ليس إثبات أهلية استخدام Stripe في أي سوق |
| W7 | [OSMF: Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/) | حدود خدمة Geocoding العامة |
| W8 | [PostgreSQL: Range types](https://www.postgresql.org/docs/current/rangetypes.html) | قيود نطاقات الوقت ومنع التداخل |
| W9 | [OpenTelemetry JS: Node](https://opentelemetry.io/docs/languages/js/getting-started/nodejs/) | أساس المراقبة والتتبع في Node |

لم تُستخدم نتائج البحث غير المطابقة للمصادر المذكورة. لا تضم الحزمة رأيًا قانونيًا أو أمنيًا معتمدًا أو اعتماد مزود دفع أو ترخيص اسم تجاري. اختيار حدود الخدمات وSprints وسياسات المنتج هو تصميم جديد في هذا التسليم، لا اقتباسًا من التوثيق الخارجي.
