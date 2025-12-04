
import { Job } from '../types';

// Flexible mapping for CSV headers to internal keys
const HEADER_MAP: Record<string, string[]> = {
  'title': ['title', 'job title', 'role', 'position'],
  'company': ['companyname', 'company_name', 'business_name', 'organization', 'company'],
  'location': ['location', 'city', 'workplace', 'region'],
  'description': ['description', 'job description', 'body', 'desc'], 
  'descriptionHtml': ['descriptionhtml', 'html description', 'description_html'], 
  'salary': ['salary', 'pay', 'compensation', 'rate'],
  'applyUrl': ['applyurl', 'joburl', 'url', 'link', 'application link', 'apply_url'],
  'applyType': ['applytype', 'apply_type', 'application_type', 'easy_apply'],
  'id': ['job_id', 'jobid', 'id', 'ref'],
  
  // Metadata
  'applicants': ['applicationscount', 'applicants', 'num_applicants'],
  'postedAt': ['postedtime', 'posted_time', 'posted at'],
  'publishedAt': ['publishedat', 'published_at', 'date', 'publish_date']
};

const normalizeSalary = (raw: string): string => {
  if (!raw) return '';
  
  const lower = raw.toLowerCase();
  
  // Skip formatting if it looks like hourly ("hr", "hour") or monthly to avoid confusing $50k/hr
  if (lower.includes('hour') || lower.includes('/hr') || lower.includes('mo') || lower.includes('month')) {
    return raw; 
  }

  // Extract all numbers, handling commas (e.g. 150,000 -> 150000)
  // We look for patterns like $140,000 or 140000
  const matches = raw.match(/(\d{1,3}(?:,\d{3})*(?:\.\d+)?)/g);
  
  if (!matches) return raw;

  // Convert to integers
  const numbers = matches
    .map(s => parseFloat(s.replace(/,/g, '')))
    .filter(n => !isNaN(n));

  // Filter for likely annual salaries (heuristic: > 10,000)
  const annualSalaries = numbers.filter(n => n > 10000);

  if (annualSalaries.length === 0) return raw;

  // Sort to find min and max
  annualSalaries.sort((a, b) => a - b);
  
  const min = annualSalaries[0];
  const max = annualSalaries[annualSalaries.length - 1];

  const formatK = (num: number) => `$${Math.round(num / 1000)}k`;

  if (min === max) {
    return `${formatK(min)}/yr`;
  }

  return `${formatK(min)} - ${formatK(max)}/yr`;
};

export const parseCSV = (text: string): Job[] => {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let insideQuotes = false;

  // 1. Robust Parser: Handle quoted fields containing newlines and commas
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentField += '"'; // Handle escaped quote ("")
        i++;
      } else {
        insideQuotes = !insideQuotes; // Toggle quote state
      }
    } else if (char === ',' && !insideQuotes) {
      currentRow.push(currentField);
      currentField = '';
    } else if ((char === '\r' || char === '\n') && !insideQuotes) {
      if (char === '\r' && nextChar === '\n') i++; // Handle CRLF
      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = '';
    } else {
      currentField += char;
    }
  }
  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  if (rows.length < 2) return [];

  // 2. Smart Header Mapping
  const headers = rows[0].map(h => h.replace(/^"|"$/g, '').trim().toLowerCase());
  const indices: Record<string, number> = {};

  Object.keys(HEADER_MAP).forEach(key => {
    const possibleNames = HEADER_MAP[key];
    for (const name of possibleNames) {
      let index = headers.findIndex(h => h === name);
      if (index === -1) {
        // Loose match, but guard against 'companyId' matching 'company'
        index = headers.findIndex(h => {
            if (key === 'company' && h.includes('id')) return false;
            return h.includes(name);
        });
      }
      if (index !== -1) {
        indices[key] = index;
        break; 
      }
    }
  });

  const jobs: Job[] = [];

  // 3. Row Extraction
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length <= 1 && (!row[0] || row[0].trim() === '')) continue;

    const getVal = (key: string): string => {
       const idx = indices[key];
       if (idx !== undefined && row[idx] !== undefined) {
         return row[idx].replace(/^"|"$/g, '').trim();
       }
       return ''; 
    };

    const title = getVal('title') || 'Unknown Role';
    const company = getVal('company') || 'Unknown Company';
    
    // Description Cleaning Logic: Drop HTML column, keep clean text
    let desc = getVal('description');
    if (!desc && indices['descriptionHtml'] !== undefined) {
        desc = getVal('descriptionHtml');
    }
    
    // Remove HTML tags if detected
    if (desc && (desc.includes('<') || desc.includes('&lt;'))) {
        // Simple regex strip. For production, DOMParser is safer but this is fast/universal for CSVs
        desc = desc.replace(/<br\s*\/?>/gi, '\n');
        desc = desc.replace(/<\/p>/gi, '\n\n');
        desc = desc.replace(/<[^>]*>?/gm, ''); 
        desc = desc.replace(/&nbsp;/g, ' ');
        desc = desc.replace(/\s+/g, ' ').trim();
    }

    if (title !== 'Unknown Role' || company !== 'Unknown Company') {
      jobs.push({
        id: getVal('id') || crypto.randomUUID(),
        title,
        company,
        location: getVal('location') || 'Remote',
        description: desc.slice(0, 5000), // Truncate huge descriptions
        salary: normalizeSalary(getVal('salary')),
        applyUrl: getVal('applyUrl'),
        applyType: getVal('applyType'), // e.g. "EASY_APPLY"
        
        applicants: getVal('applicants'),
        postedAt: getVal('postedAt'),
        publishedAt: getVal('publishedAt'),

        matchScore: undefined,
        visaRisk: undefined,
        status: 'NEW'
      });
    }
  }

  return jobs;
};
