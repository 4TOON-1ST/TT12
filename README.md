# TT12 - ویسکال آنلاین 🎙️

یک ویسکال آنلاین سبک و سریع با WebRTC و Socket.io — بدون ثبت‌نام، بدون نصب، فقط با یک کد ۶ رقمی وارد شوید.

## ✨ امکانات

- 🎙️ **ویسکال P2P** با کیفیت بالا (WebRTC mesh، رمزنگاری‌شده)
- 💬 **چت متنی و تصویری** در کنار ویسکال
- 🎤 **مدیریت میکروفون پیشرفته**:
  - کارت وضعیت میکروفون (آماده / رد شده / پیدا نشد / خطا)
  - انتخاب دستگاه از بین میکروفون‌های موجود
  - تست میکروفون با نمایش لحظه‌ای سطح صدا (VU meter)
  - درخواست دوباره دسترسی با یک کلیک
  - راهنمای رفع مشکل در صورت رد دسترسی
- 🌓 **تم تیره و روشن** با ذخیره‌سازی انتخاب کاربر
- 🔢 **اتاق با کد ۶ رقمی** - بساز، کد رو بده به دوستت
- 👥 **تا ۱۰ نفر** در یک اتاق
- 🔇 **کنترل میکروفون** (mute/unmute)
- 🎨 **نشانه‌گر صحبت‌کننده** (افکت پالس روی آواتار)
- 📋 **کپی کد و اشتراک‌گذاری لینک** دعوت
- 🌐 **کاملاً فارسی و RTL** با فونت Vazirmatn
- 📱 **کاملاً واکنش‌گرا** (موبایل و دسکتاپ)

## 🚀 اجرای محلی (Development)

```bash
# 1. نصب پکیج‌ها
bun install
cd mini-services/voice-service && bun install && cd ../..

# 2. اجرای سرور Next.js (پورت 3000) - ترمینال 1
bun run dev

# 3. اجرای voice-service (پورت 3003) - ترمینال 2
cd mini-services/voice-service
bun run dev

# 4. باز کنید در مرورگر: http://localhost:81 (پشت Caddy)
```

## ☁️ استقرار روی Railway (Production)

**معماری:** در production، فایل `server.js` در ریشه پروژه هم Next.js و هم Socket.io رو روی یک پورت واحد (PORT) اجرا می‌کنه. این یعنی فقط یک Railway service لازمه!

### مراحل:

1. **کد رو به GitHub push کن**
2. در [Railway](https://railway.app) یک پروژه جدید از GitHub repo بساز
3. Railway فایل‌های زیر رو می‌خونه:
   - `nixpacks.toml` — Node.js 22 و دستورات install/build/start
   - `railway.json` — startCommand: `node server.js`
   - `Procfile` — fallback: `web: node server.js`
4. Railway به‌صورت خودکار:
   - Node.js 22 رو نصب می‌کنه (نه Node 18 که EOL شده)
   - `npm install` یا `bun install` رو اجرا می‌کنه
   - `npm run build` رو اجرا می‌کنه (Next.js standalone build می‌سازه)
   - در نهایت `node server.js` رو روی پورتی که بهت میده اجرا می‌کنه
5. متغیر محیطی `PORT` به‌صورت خودکار توسط Railway تنظیم می‌شه - نیازی به تنظیم دستی نیست

### متغیرهای محیطی

| متغیر | توضیح | پیش‌فرض |
|------|--------|---------|
| `PORT` | پورت سرور (Railway خودش ست می‌کنه) | `3000` |
| `NEXT_PUBLIC_VOICE_SERVICE_URL` | URL Socket.io در production | `/socket.io` |

### نکات مهم

- **WebSocket**: Railway از WebSocket پشتیبانی می‌کنه - نیازی به تنظیم اضافی نیست
- **دیتابیس**: نیازی نیست - state در RAM ذخیره می‌شه
- **STUN**: از Google STUN رایگان استفاده می‌شه
- **Worker جداگانه لازم نیست** - همه‌چیز روی یک process اجرا می‌شه (بهینه برای Railway رایگان)

## 📁 ساختار فایل‌ها

```
.
├── server.js              # سرور تولید: Next.js + Socket.io روی یک پورت
├── package.json           # scripts: dev / build / start (node server.js)
├── nixpacks.toml          # پیکربندی Railway با Node.js 22
├── railway.json           # پیکربندی Railway
├── Procfile               # Fallback برای Railway
├── .node-version          # Node 22
├── .nvmrc                 # Node 22
├── src/
│   ├── app/
│   │   ├── layout.tsx     # ریشه RTL فارسی + Vazirmatn + ThemeProvider
│   │   ├── page.tsx       # روت اصلی (Landing یا RoomView)
│   │   └── globals.css    # تم تیره/روشن + انیمیشن‌ها
│   ├── components/
│   │   ├── landing.tsx           # صفحه ورودی
│   │   ├── room-view.tsx         # صفحه اتاق
│   │   ├── mic-permission-card.tsx # کارت مدیریت میکروفون
│   │   ├── theme-toggle.tsx     # دکمه سوییچ تم
│   │   └── ui/                  # shadcn/ui components
│   └── hooks/
│       └── use-voice-room.ts    # hook اصلی: WebRTC + Socket.io + state
├── mini-services/
│   └── voice-service/           # فقط برای dev محلی - در production از server.js استفاده می‌شه
└── public/
```

## 🎯 جریان کاربری

1. **ورود**: کاربر اسمش رو می‌نویسه، با کارت میکروفون دسترسی می‌ده
2. **ساخت اتاق**: سرور یک کد ۶ رقمی می‌سازه (مثل `92EDJ2`)
3. **اشتراک‌گذاری**: کاربر کد رو به دوستش می‌ده
4. **ورود دوست**: دوست اسمش رو می‌نویسه + کد رو وارد می‌کنه
5. **شروع ویسکال**: WebRTC بین مرورگرها اتصال برقرار می‌کنه
6. **چت**: کنار صفحه، پیام متنی یا تصویر بفرستید
7. **خروج**: دکمه «خروج» - اتاق وقتی خالی بشه خودکار پاک می‌شه

## 🔧 تکنولوژی‌ها

- Next.js 16 (App Router) + React 19 + TypeScript 5
- Tailwind CSS 4 + shadcn/ui + next-themes
- Socket.io 4.8 + WebRTC (mesh topology)
- Framer Motion + Vazirmatn font
- Lucide Icons
- Node.js 22 (LTS)

## 🐛 رفع مشکل Railway

### اگر خطای "Application failed to respond" گرفتید:

این یعنی سرور اجرا نمی‌شه یا روی پورت اشتباه listen می‌کنه. مراحل رفع:

1. مطمئن شوید `server.js` در ریشه پروژه وجود داره
2. مطمئن شوید `package.json` داره:
   ```json
   "scripts": {
     "build": "next build && cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/",
     "start": "node server.js"
   }
   ```
3. در Railway: **Settings → Deploy → Start Command** باید `node server.js` باشه (خالی بذار تا از `nixpacks.toml` استفاده کنه)
4. در Railway: **Settings → Build → Clear Build Cache** رو بزنید و redeploy کنید
5. لاگ‌ها رو در Railway بررسی کنید (Deploy Logs)

### اگر خطای "Node.js 18.x has reached End-Of-Life" گرفتید:

- مطمئن شوید `nixpacks.toml` به‌درستی `nodejs_22` رو لیست می‌کنه:
  ```toml
  [phases.setup]
  nixpkgs = ["nodejs_22"]
  ```
- در Railway: **Settings → Variables** متغیر `NODE_VERSION` = `22` رو اضافه کنید
- **Clear Build Cache** رو بزنید و redeploy کنید

### اگر خطای Build Failed:
- مطمئن شوید `next.config.ts` داره: `output: "standalone"`
- لاگ‌های build رو بررسی کنید - معمولاً مشکل dependency هست

### اگر میکروفون کار نمی‌کنه:
- مطمئن شوید سایت روی HTTPS هست (WebSocket نیاز به secure context داره)
- روی آیکون قفل کنار URL کلیک کن و دسترسی میکروفون رو Allow کن

## 📝 لایسنس
MIT
