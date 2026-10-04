import re

with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

def replacer(func_name, key_name, is_load=True, is_async=True):
    global content
    if is_load:
        pattern = f"function {func_name}\(\) {{\\s*try {{\\s*const stored = localStorage.getItem\({key_name}\);\\s*if \(stored\) {{"
        replacement = f"""async function {func_name}() {{
            try {{
                let stored = null;
                if (supabaseClient) {{
                    const {{ data, error }} = await supabaseClient.from('app_storage').select('value').eq('key', {key_name}).maybeSingle();
                    if (data) stored = JSON.stringify(data.value);
                }} else {{
                    stored = localStorage.getItem({key_name});
                }}
                if (stored) {{"""
        content = re.sub(pattern, replacement, content)
    else:
        # For save
        pattern = f"function {func_name}\(\) {{\\s*try {{\\s*localStorage.setItem\({key_name}, JSON.stringify\((.*?)\)\);"
        replacement = f"""async function {func_name}() {{
            try {{
                if (supabaseClient) {{
                    await supabaseClient.from('app_storage').upsert({{ key: {key_name}, value: \\1 }});
                }} else {{
                    localStorage.setItem({key_name}, JSON.stringify(\\1));
                }}"""
        content = re.sub(pattern, replacement, content)

replacer('loadChairEventEmails', 'CHAIR_EVENT_EMAILS_STORAGE_KEY', True)
replacer('saveChairEventEmails', 'CHAIR_EVENT_EMAILS_STORAGE_KEY', False)
replacer('loadPaymentRecords', 'PAYMENT_RECORDS_STORAGE_KEY', True)
replacer('savePaymentRecords', 'PAYMENT_RECORDS_STORAGE_KEY', False)
replacer('loadEmailInboxLogs', 'EMAIL_INBOX_LOGS_STORAGE_KEY', True)
replacer('saveEmailInboxLogs', 'EMAIL_INBOX_LOGS_STORAGE_KEY', False)

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(content)

