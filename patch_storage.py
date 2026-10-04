import re

with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace saveToStorage
save_to_storage_repl = """        async function saveToStorage() {
            try {
                const data = {
                    categoriesData,
                    divisionsData,
                    clubMemberDatabase,
                    registrationOrders,
                    chairConfig,
                    chairPaymentRecords,
                    emailInboxLogs,
                    lastUpdated: new Date().toISOString()
                };
                if (supabaseClient) {
                    await supabaseClient.from('app_storage').upsert({ key: LOCAL_STORAGE_KEY, value: data });
                } else {
                    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
                }
            } catch (e) {
                console.warn("無法寫入 Storage", e);
            }
        }"""
content = re.sub(r'function saveToStorage\(\) \{.*?(?=function loadFromStorage)', save_to_storage_repl + '\n\n        ', content, flags=re.DOTALL)

# Replace loadFromStorage
load_from_storage_repl = """        async function loadFromStorage() {
            try {
                let stored = null;
                if (supabaseClient) {
                    const { data, error } = await supabaseClient.from('app_storage').select('value').eq('key', LOCAL_STORAGE_KEY).maybeSingle();
                    if (data) stored = JSON.stringify(data.value);
                } else {
                    stored = localStorage.getItem(LOCAL_STORAGE_KEY);
                }
                if (stored) {"""
content = re.sub(r'function loadFromStorage\(\) \{\s*try \{\s*const stored = localStorage.getItem\(LOCAL_STORAGE_KEY\);\s*if \(stored\) \{', load_from_storage_repl, content)

# Replace resetSystemData
reset_system_data_repl = """        async function resetSystemData() {
            if (confirm("⚠️ 確定將所有社友名冊與報名資料重置為初始預設值？本機修改將被清除。\\n（📌 活動 Email 與密碼設定將保留不變）")) {
                if (supabaseClient) {
                    await supabaseClient.from('app_storage').delete().eq('key', LOCAL_STORAGE_KEY);
                }
                localStorage.removeItem(LOCAL_STORAGE_KEY);"""
content = re.sub(r'function resetSystemData\(\) \{\s*if \(confirm\(.*?\{\s*localStorage.removeItem\(LOCAL_STORAGE_KEY\);', reset_system_data_repl, content)

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(content)

