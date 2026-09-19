# إنشاء المستودع على حساب baraabd

## الحالة عند التسليم

تم التحقق عبر موصل GitHub من أن الحساب المتصل هو baraabd. الموصل المتاح يتيح التعامل
مع مستودعات موجودة، لكنه لا يوفر عملية إنشاء مستودع جديد. لم تُنفذ إنشاء/رفع/دمج/نشر عن بعد.
لا تُرسل token أو كلمة مرور إلى المحادثة. السكربت المرفق يعمل فقط بتسجيل دخولك على جهازك.

اسم المستودع المقترح من المخطط: `carwash-platform`.
الحساب المقصود: `baraabd`. الخصوصية المقترحة: Private. العلامة المعروضة داخل التطبيق: WashGo.
الاسم تقني قابل لقرار لاحق وليس تسجيلًا لعلامة تجارية.

## المسار الأول: إنشاء ورفع الحزمة بأمر واحد على جهازك

يلزم Git وNode وGitHub CLI مثبتة على جهازك، مع إعداد اسم وبريد مؤلف Git الحقيقيين.
فك ZIP في مجلد جديد مستقل، وليس داخل homeservicemarketplace أو مستودع آخر.
افتح Terminal في مجلد carwash-platform الذي يحتوي package.json وAGENTS.md.

```powershell
git --version
node --version
gh --version
gh auth login --hostname github.com --web
node scripts/create-github-repo.mjs
```

الأمر الأخير يعرض الخطة ولا يتصل بـGitHub ولا ينشئ شيئًا.
بعد مراجعة الاسم والخصوصية نفّذ:

```powershell
node scripts/create-github-repo.mjs --create
```

السكربت يتحقق من البصمات ومن الحساب baraabd، يرفض مجلدًا داخل مستودع موجود،
ينشئ فرع main وcommit، ثم يستخدم `gh repo create --private --source ... --push`.
بعد ذلك يتحقق من الخصوصية ومن مساواة commit المحلي بمرجع main على الخادم.
لا يستخدم force، ولا يحذف ملفات أو مستودعات، ولا ينقل المشروع القديم.
لا يشغل Docker أو عمليات تحصيل ولا ينشئ صلاحيات فرع أو أسرارًا أو نشرًا تلقائيًا.
قد تستهلك عمليات GitHub Actions رصيد الخطة؛ راجع إعدادات الفوترة عند تفعيلها.

إن فشل بعد بدء العمل فقد تبقى خطوات محلية أو مستودع جزئي. السكربت لا يعيد الكتابة فوق .git.
افحص git status وgit remote -v وصفحة GitHub قبل المتابعة. لا تحذف .git ولا تستخدم force
بغرض تجاوز خطأ. المسار المتصل لم يُنفذ ضمن بيئة إعداد الحزمة؛ اختبرت صيغة السكربت
ووضع العرض فقط، وليس OAuth أو الإنشاء أو push.

## المسار الثاني: صفحة GitHub فقط

رابط ملء الحقول مسبقًا:
https://github.com/new?owner=baraabd&name=carwash-platform&visibility=private&description=WashGo%20mobile%20car%20wash%20platform

تحقق يدويًا من Owner وRepository name وPrivate. لا تضف README أو .gitignore أو ترخيصًا
عند اختيار استيراد الحزمة المحلية بهذا المسار؛ الملفات موجودة في الحزمة.
اضغط Create repository. إنشاء المستودع الفارغ لا يرفع الحزمة.

بعد الإنشاء، ومن مجلد الحزمة الجديد المستقل، مع مصادقة Git على جهازك:

```powershell
node scripts/check-design-reference.mjs
git init --initial-branch=main
git add .
git commit -m "chore: bootstrap carwash with frozen WashGo design"
git remote add origin https://github.com/baraabd/carwash-platform.git
git push -u origin main
```

اختر مسارًا واحدًا؛ لا تستخدم سكربت إنشاء مستودع جديد بعد إنشاء الاسم نفسه يدويًا.
عند حاجة الوصول من المحادثة، تأكد أن تثبيت موصل GitHub يشمل المستودع الجديد.

## حماية المرجع بعد الرفع

CODEOWNERS ملف توجيه للمراجعة فقط. راجع خطة GitHub وفعّل قواعد main/develop المتاحة:
اشتراط Pull Request والفحص `Frozen design reference`، منع force-push والحذف،
وإلزام مراجعة مالك الكود للتغييرات المنطبقة. لا يُفترض توافر الحماية للمستودع الخاص
في كل خطط GitHub. صاحب PR لا يستطيع اعتماد PR الخاص به بوصفه المراجع الوحيد؛
احفظ قرار المالك الصريح ولا تدّعِ أن القاعدة تصنع موافقة مستقلة.
الفحص الحالي لحماية المرجع ليس بوابة إطلاق أو اختبار مطابقة React. لا تعلن CI شاملًا أخضر.

## التوثيق الرسمي

- https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository
- https://cli.github.com/manual/gh_repo_create
- https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners
