// "Fill in for me": the assistant fills the empty fields of a form for
// someone too busy to, from what they've already typed and what the form
// is about (the goal and its steps, where there is one). It never makes up
// people, contact or bank details or money, and only proposes: the page
// puts the values in the form for the person to check and save.
const FIELD_TYPES = new Set(['text', 'longtext', 'date', 'number', 'choice', 'list']);
const LIMIT = { text: 200, longtext: 1000 };

// The form's fields as the page described them, cleaned.
function cleanFields(fields) {
  if (!Array.isArray(fields)) return [];
  return fields.slice(0, 15).map(f => ({
    key: String((f && f.key) || '').replace(/[^\w-]/g, '').slice(0, 40),
    label: String((f && f.label) || '').replace(/\s+/g, ' ').trim().slice(0, 80),
    type: FIELD_TYPES.has(f && f.type) ? f.type : 'text',
    options: Array.isArray(f && f.options) ? f.options.slice(0, 20).map(o => String(o).slice(0, 60)) : null,
    hint: String((f && f.hint) || '').replace(/\s+/g, ' ').trim().slice(0, 160),
  })).filter(f => f.key && f.label && (f.type !== 'choice' || (f.options && f.options.length)));
}

// The tool the model answers with: one optional property per field.
function fillTool(fields) {
  const properties = {};
  fields.forEach(f => {
    const description = `${f.label}${f.hint ? `. ${f.hint}` : ''}`;
    if (f.type === 'number') properties[f.key] = { type: 'number', description };
    else if (f.type === 'choice') properties[f.key] = { type: 'string', enum: f.options, description };
    else if (f.type === 'date') properties[f.key] = { type: 'string', description: `${description}. A date, YYYY-MM-DD.` };
    else if (f.type === 'list') properties[f.key] = { type: 'array', items: { type: 'string' }, description: `${description}. Short items, up to 8.` };
    else properties[f.key] = { type: 'string', description };
  });
  return { name: 'fill_form', description: 'Fill in the empty fields of the form. Leave out any field you cannot sensibly fill.', input_schema: { type: 'object', properties } };
}

// Only what was asked for, of the right kind and size.
function validate(fields, input, today) {
  const out = {};
  fields.forEach(f => {
    const v = input ? input[f.key] : undefined;
    if (v == null || v === '') return;
    if (f.type === 'number') { const n = Number(v); if (Number.isFinite(n) && n >= 0 && n < 1e7) out[f.key] = n; return; }
    if (f.type === 'choice') { if (f.options.includes(v)) out[f.key] = v; return; }
    if (f.type === 'date') { if (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && v >= today) out[f.key] = v; return; }
    if (f.type === 'list') { if (Array.isArray(v)) out[f.key] = v.map(x => String(x).replace(/\s+/g, ' ').trim().slice(0, 120)).filter(Boolean).slice(0, 8); return; }
    const s = String(v).trim().slice(0, LIMIT[f.type] || 200);
    if (s) out[f.key] = s;
  });
  return out;
}

function systemPrompt(today, name) {
  return `You fill in a form in Wayrise, a goal and task planner, for ${name || 'someone'} who is busy and wants it done for them. Today is ${today}.
Fill in the fields that are empty, so the whole form makes sense together with what is already filled in and the context. Be specific and practical, and keep it short.
Write in plain, warm British English, like a helpful friend. No emojis, no hashtags, no dashes used as punctuation, no bullet points, and do not repeat the field's label.
Never make up people's names, email addresses, phone numbers, bank or payment details, or amounts of money. Leave those fields out unless the context gives them.
Dates are YYYY-MM-DD, on or after today, and realistic for the work. Leave out any field you cannot sensibly fill.`;
}

module.exports = { cleanFields, fillTool, validate, systemPrompt };
