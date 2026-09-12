// ═══════════════════════════════════════════════════════════════
// DB.JS — Database Layer
// Reads/writes to database.json. Replace with SQLite later.
// ═══════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'database.json');

const DEFAULT_DB = {
  profile: {
    name: "Your Name",
    tagline: "My Life & Wealth Tracker",
    currency: "£",
    targetNetWorth: 100000,
    targetDate: "2027-05-01"
  },
  projects: [
    { id:"p1", title:"UK Career Goals",            type:"career",   description:"Certifications, jobs and professional development", color:"#0A7E8C", icon:"🎓", createdAt:"2026-05-01" },
    { id:"p2", title:"Business & Entrepreneurship", type:"business", description:"UK and Nigeria business ventures",                  color:"#C0642A", icon:"🚀", createdAt:"2026-05-01" },
    { id:"p3", title:"Investments & Wealth",        type:"wealth",   description:"ISA, stocks, crypto and savings targets",          color:"#1A7A4A", icon:"📈", createdAt:"2026-05-01" },
    { id:"p4", title:"Family & Life Goals",         type:"life",     description:"Spouse visa, family milestones, personal goals",   color:"#5B2C6F", icon:"👨‍👩‍👧", createdAt:"2026-05-01" }
  ],
  tasks: [
    { id:"t1",  projectId:"p1", title:"Azure Data Engineer (DP-203)",    category:"Data Engineering", status:"In Progress",  priority:"High",   startDate:"2026-05-01", endDate:"2026-08-31", cost:165,   notes:"Study via MS Learn + Udemy" },
    { id:"t2",  projectId:"p1", title:"AWS Cloud Practitioner",           category:"Cloud",            status:"In Progress",  priority:"High",   startDate:"2026-05-01", endDate:"2026-07-31", cost:100,   notes:"A Cloud Guru + practice exams" },
    { id:"t3",  projectId:"p1", title:"PRINCE2 Foundation",               category:"PM Certs",         status:"Not Started",  priority:"High",   startDate:"2026-07-01", endDate:"2026-07-31", cost:175,   notes:"Self-study official manual" },
    { id:"t4",  projectId:"p1", title:"PRINCE2 Practitioner",             category:"PM Certs",         status:"Not Started",  priority:"High",   startDate:"2026-08-01", endDate:"2026-08-31", cost:235,   notes:"Open book exam" },
    { id:"t5",  projectId:"p1", title:"PMP Certification",                category:"PM Certs",         status:"Not Started",  priority:"High",   startDate:"2026-09-01", endDate:"2026-10-31", cost:422,   notes:"Join PMI first to save 40%" },
    { id:"t6",  projectId:"p1", title:"CSCS Gold Card",                   category:"CSCS",             status:"Not Started",  priority:"High",   startDate:"2026-06-01", endDate:"2026-07-31", cost:58.50, notes:"CITB test first, then apply" },
    { id:"t7",  projectId:"p1", title:"UK Driving Licence",               category:"Driving",          status:"Not Started",  priority:"High",   startDate:"2026-06-01", endDate:"2026-10-31", cost:1135,  notes:"Theory + lessons + practical" },
    { id:"t8",  projectId:"p1", title:"Data Engineer Role (UK)",          category:"Tech Job",         status:"In Progress",  priority:"High",   startDate:"2026-05-01", endDate:"2026-08-31", cost:0,     notes:"Apply 5+/week on LinkedIn" },
    { id:"t9",  projectId:"p1", title:"NHS Data/Analytics Role",          category:"NHS",              status:"In Progress",  priority:"High",   startDate:"2026-05-01", endDate:"2026-07-31", cost:0,     notes:"jobs.nhs.uk Band 6-7" },
    { id:"t10", projectId:"p2", title:"Register Sole Trader / Ltd Co",    category:"Setup",            status:"Not Started",  priority:"High",   startDate:"2026-05-01", endDate:"2026-06-30", cost:0,     notes:"gov.uk — free, 15 mins" },
    { id:"t11", projectId:"p2", title:"Data/Tech Consulting — 1st Client",category:"Consulting",       status:"Not Started",  priority:"High",   startDate:"2026-06-01", endDate:"2026-08-31", cost:0,     notes:"Upwork + LinkedIn. £300-600/day" },
    { id:"t12", projectId:"p2", title:"UK-Nigeria Hair Import — Launch",  category:"Import/Export",    status:"Not Started",  priority:"High",   startDate:"2026-06-01", endDate:"2026-09-30", cost:1000,  notes:"Source Lagos suppliers, sell on eBay/Amazon" },
    { id:"t13", projectId:"p2", title:"AI Services for UK SMEs",          category:"AI Services",      status:"Not Started",  priority:"High",   startDate:"2026-06-01", endDate:"2026-08-31", cost:200,   notes:"£500 setup + £200-500/mo retainer" },
    { id:"t14", projectId:"p3", title:"Open Stocks & Shares ISA",         category:"ISA",              status:"Not Started",  priority:"High",   startDate:"2026-05-01", endDate:"2026-06-30", cost:0,     notes:"Vanguard or Hargreaves Lansdown" },
    { id:"t15", projectId:"p3", title:"Set up £200/mo into VWRL ETF",     category:"ISA",              status:"Not Started",  priority:"High",   startDate:"2026-06-01", endDate:"2026-06-30", cost:0,     notes:"8-12%/yr avg return" },
    { id:"t16", projectId:"p3", title:"Emergency Fund (£5K target)",      category:"Savings",          status:"Not Started",  priority:"High",   startDate:"2026-05-01", endDate:"2026-09-30", cost:0,     notes:"Marcus or Chase — 3.5-4.5% interest" },
    { id:"t17", projectId:"p4", title:"Gather Spouse Visa Documents",     category:"Visa",             status:"Not Started",  priority:"High",   startDate:"2026-09-01", endDate:"2026-11-30", cost:0,     notes:"6mths payslips, bank statements" },
    { id:"t18", projectId:"p4", title:"Submit Spouse Visa Application",   category:"Visa",             status:"Not Started",  priority:"High",   startDate:"2026-11-01", endDate:"2026-11-30", cost:1846,  notes:"Appendix FM — gov.uk/spouse-visa" },
    { id:"t19", projectId:"p4", title:"Wife Arrives in UK 🎉",            category:"Family",           status:"Not Started",  priority:"High",   startDate:"2027-01-01", endDate:"2027-01-31", cost:500,   notes:"Book flights early" }
  ],
  wealth: {
    entries: { savings:0, isa:0, nigeria_biz:0, uk_biz:0, property:0, crypto:0, other:0 },
    targets: {
      savings:     { label:"💰 Savings (Emergency Fund)", target:5000  },
      isa:         { label:"📈 Stocks & Shares ISA",      target:20000 },
      nigeria_biz: { label:"🇳🇬 Nigeria Business",        target:15000 },
      uk_biz:      { label:"🇬🇧 UK Business Income",      target:20000 },
      property:    { label:"🏠 Property / Assets",        target:30000 },
      crypto:      { label:"₿ Crypto (max 5%)",           target:5000  },
      other:       { label:"🔄 Other Investments",        target:5000  }
    },
    monthlyLog: []
  },
  actions: [
    { id:"a1", text:"Open Stocks & Shares ISA on Vanguard or HL",     area:"💰 Investments", by:"Jun 2026", priority:"Do Now", done:false },
    { id:"a2", text:"Register as Sole Trader on gov.uk",               area:"🚀 Business",    by:"Jun 2026", priority:"Do Now", done:false },
    { id:"a3", text:"Book UK Theory Test at Pearson VUE",              area:"🚗 Driving",     by:"Jun 2026", priority:"Do Now", done:false },
    { id:"a4", text:"Book CITB Managers H&S Test",                     area:"🦺 CSCS",        by:"Jun 2026", priority:"Do Now", done:false },
    { id:"a5", text:"Apply to 5 Data Engineer roles this week",        area:"💻 Tech Job",    by:"Ongoing",  priority:"Do Now", done:false }
  ]
};

// ── READ / WRITE ─────────────────────────────────────────────────
function readDB() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      writeDB(DEFAULT_DB);
      return DEFAULT_DB;
    }
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch (e) {
    console.error('DB read error:', e.message);
    return DEFAULT_DB;
  }
}

function writeDB(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('DB write error:', e.message);
  }
}

module.exports = { readDB, writeDB };
