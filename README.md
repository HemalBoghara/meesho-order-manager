# 📦 Meesho Order Manager (Python)

Meesho સપ્લાયર પેનલમાંથી Pending Orders ઓટોમેટિક લાવવા અને એક જ ક્લિકમાં બધા ઓર્ડર્સ Accept (સ્વીકારવા) માટેનું સ્માર્ટ ઓટોમેશન ટૂલ.

---

## 🚀 Key Features

1. **🔐 Auto & Interactive Login**:
   - Meesho Supplier Panel (`supplier.meesho.com`) માં તમારા ID/Password થી લોગિન.
   - **સેશન સેવિંગ**: એકવાર લોગિન થયા પછી બ્રાઉઝર સેશન `session_data/` માં સુરક્ષિત સેવ રહેશે, જેથી વારંવાર OTP નાખવો ન પડે.
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

## 🛠️ How to Run (Node.js - Recommended)

### Method 1: Double Click `start-node.bat`
`meesho-order-manager` ફોલ્ડરમાં રહેલ `start-node.bat` ફાઇલ પર ડબલ ક્લિક કરો. સર્વર ચાલુ થઈ જશે અને તમારા બ્રાઉઝરમાં `http://127.0.0.1:8000` આપમેળે ખૂલી જશે.

### Method 2: Command Line (Node.js)
```powershell
cd "C:\Users\Hemal Boghara\.gemini\antigravity-ide\scratch\meesho-order-manager"
npm install
npm start
```

### 🚀 Hostinger Deployment
સંપૂર્ણ વિગતવાર સ્ટેપ-બાય-સ્ટેપ ગાઈડ માટે [HOSTINGER_DEPLOY_GUIDE.md](file:///C:/Users/Hemal%20Boghara/.gemini/antigravity-ide/scratch/meesho-order-manager/HOSTINGER_DEPLOY_GUIDE.md) જુઓ (Hostinger VPS & Docker / PM2).

---

## 📁 File Structure

```
meesho-order-manager/
├── meesho_bot.py         # Playwright ઓટોમેશન એન્જિન
├── app.py                # FastAPI બેકેન્ડ સર્વર
├── run.py                # ઓટો બ્રાઉઝર લોન્ચર સ્ક્રિપ્ટ
├── start.bat             # વન-ક્લિક વિન્ડોઝ લોન્ચર
├── config.json           # સેટિંગ્સ અને ક્રેડેન્શિયલ્સ
├── latest_orders.json    # કેશ્ડ ઓર્ડર્સ ડેટા
├── templates/
│   └── index.html        # રિસ્પોન્સિવ ડાર્ક મોડ ડેશબોર્ડ
└── static/
    ├── css/style.css     # ગ્લાસમોર્ફિઝમ ડિઝાઇન અને એનિમેશન્સ
    └── js/app.js         # ઇન્ટરેક્ટિવ ક્લાયન્ટ લોજિક
```
