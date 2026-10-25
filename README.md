# 📦 Meesho Order Manager (Node.js)

Meesho સપ્લાયર પેનલમાંથી Pending Orders ઓટોમેટિક લાવવા અને એક જ ક્લિકમાં બધા ઓર્ડર્સ Accept (સ્વીકારવા) માટેનું સ્માર્ટ ઓટોમેશન ટૂલ (100% Pure Node.js & Playwright).

---

## 🚀 Key Features

1. **🔐 Auto & Interactive Login**:
   - Meesho Supplier Panel (`supplier.meesho.com`) માં તમારા ID/Password થી લોગિન.
   - **સેશન સેવિંગ**: એકવાર લોગિન થયા પછી બ્રાઉઝર સેશન `sessions/` માં સુરક્ષિત સેવ રહેશે, જેથી વારંવાર OTP નાખવો ન પડે.
   - જો OTP / Captcha આવે તો બ્રાઉઝર વિન્ડોમાં તમે આસાનીથી OTP ભરી શકો છો.

2. **📋 Live Pending Orders Fetching**:
   - Meesho ના પેન્ડિંગ ઓર્ડર્સ (Sub-Order ID, SKU, પ્રોડક્ટ વિગત, પ્રાઈસ, ક્વોન્ટિટી, SLA ડિસ્પેચ તારીખ) લાઇવ ખેંચીને ટેબલમાં બતાવશે.
   - સર્ચ અને ફિલ્ટર સપોર્ટ (SKU કે ઓર્ડર ID થી શોધો).

3. **⚡ Single-Click Accept Orders**:
   - **Accept Selected**: તમને ગમતા ચોક્કસ ઓર્ડર ચેકબોક્સથી સિલેક્ટ કરીને સ્વીકારો.
   - **Accept All Orders**: બધા જ પેન્ડિંગ ઓર્ડરને એક સાથે બલ્ક એક્સેપ્ટ કરો.

4. **💻 Real-Time Bot Terminal**:
   - બ્રાઉઝરમાં બોટ કયું કામ કરી રહ્યું છે તે રિયલ-ટાઇમ કન્સોલ લોગ્સમાં દેખાશે.

---

## 🛠️ How to Run (Node.js)

### Method 1: Double Click `start-node.bat`
`meesho-order-manager` ફોલ્ડરમાં રહેલ `start-node.bat` ફાઇલ પર ડબલ ક્લિક કરો. સર્વર ચાલુ થઈ જશે અને તમારા બ્રાઉઝરમાં `http://127.0.0.1:8000` આપમેળે ખૂલી જશે.

### Method 2: Command Line (Node.js)
```powershell
cd "C:\Users\Hemal Boghara\.gemini\antigravity-ide\scratch\meesho-order-manager"
npm install
npm start
```

### 🚀 Deployment (Docker / VPS / Hostinger)
સંપૂર્ણ વિગતવાર સ્ટેપ-બાય-સ્ટેપ ગાઈડ માટે [HOSTINGER_DEPLOY_GUIDE.md](file:///C:/Users/Hemal%20Boghara/.gemini/antigravity-ide/scratch/meesho-order-manager/HOSTINGER_DEPLOY_GUIDE.md) જુઓ (Docker / PM2).

---

## 📁 File Structure

```
meesho-order-manager/
├── server.js             # Express.js REST API & Dashboard Server
├── meeshoBot.js          # Playwright (Node.js) Automation Engine
├── botManager.js         # Multi-store manager & log emitter
├── scheduler.js          # Background auto-accept & fetch scheduler
├── browserHelper.js      # Headless / Chromium launcher helper
├── db.js                 # Multi-user & account JSON database
├── ecosystem.config.js   # PM2 production configuration
├── Dockerfile            # Official Playwright Node.js container
├── docker-compose.yml    # Docker compose deployment
├── start-node.bat        # Windows one-click launcher
├── package.json          # Node.js dependencies & scripts
├── templates/
│   └── index.html        # Responsive Dark Mode Dashboard
└── static/
    ├── css/style.css     # Glassmorphism styling & animations
    └── js/app.js         # Interactive client logic
```
