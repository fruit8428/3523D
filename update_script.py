import re

with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Add Supabase CDN to head
head_tag = '<!-- Chart.js CDN -->'
supabase_script = '''    <!-- Supabase CDN -->
    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
    <script>
        // ================= SUPABASE CONFIGURATION =================
        // 請在此填入您的 Supabase 專案 URL 與 anon key
        const SUPABASE_URL = 'YOUR_SUPABASE_URL';
        const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
        let supabaseClient = null;
        if (SUPABASE_URL !== 'YOUR_SUPABASE_URL' && SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY') {
            supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        }
    </script>
'''
content = content.replace(head_tag, supabase_script + head_tag)

# Replace DOMContentLoaded
content = content.replace(
    "document.addEventListener('DOMContentLoaded', () => {",
    "document.addEventListener('DOMContentLoaded', async () => {"
)
content = content.replace(
    "loadFromStorage();",
    "await loadFromStorage();"
)
content = content.replace(
    "loadChairEventEmails();",
    "await loadChairEventEmails();"
)
content = content.replace(
    "loadPaymentRecords();",
    "await loadPaymentRecords();"
)
content = content.replace(
    "loadEmailInboxLogs();",
    "await loadEmailInboxLogs();"
)

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(content)

