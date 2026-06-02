const STATUSES     = ['new', 'interested', 'applied', 'saved', 'rejected'];
const STATUS_LABEL = { new: 'New', interested: 'Interested', applied: 'Applied', saved: 'Saved', rejected: 'Rejected' };

let allJobs = [];
let filters = { search: '', status: 'all', sortCol: 'scraped_at', sortDir: 'desc' };

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function init() {
    try {
        const res = await fetch('/jobs');
        if (!res.ok) throw new Error(`/jobs returned ${res.status}`);
        allJobs = await res.json();
    } catch (err) {
        document.getElementById('job-rows').innerHTML =
            `<tr><td colspan="5" class="empty">Failed to load jobs: ${escapeHtml(err.message)}</td></tr>`;
        return;
    }
    updateStats();
    renderTable(applyFilters());
    wireFilters();
    syncSortHeaders();
}

// ── Filtering + sorting ───────────────────────────────────────────────────────

function applyFilters() {
    const { search, status, sortCol, sortDir } = filters;
    return allJobs
        .filter((j) => {
            if (search &&
                !j.job_title.toLowerCase().includes(search) &&
                !j.company_name.toLowerCase().includes(search)) return false;
            if (status !== 'all' && j.user_status !== status) return false;
            return true;
        })
        .sort((a, b) => {
            // date fields (posting_date, scraped_at) are ISO strings — lex order = chron order
            const av = String(a[sortCol] ?? '').toLowerCase();
            const bv = String(b[sortCol] ?? '').toLowerCase();
            const cmp = av < bv ? -1 : av > bv ? 1 : 0;
            return sortDir === 'asc' ? cmp : -cmp;
        });
}

function syncSortHeaders() {
    document.querySelectorAll('th[data-col]').forEach((th) => {
        const icon = th.querySelector('.sort-icon');
        if (th.dataset.col === filters.sortCol) {
            th.dataset.sortDir = filters.sortDir;
            icon.textContent   = filters.sortDir === 'asc' ? '▲' : '▼';
        } else {
            delete th.dataset.sortDir;
            icon.textContent = '';
        }
    });
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function updateStats() {
    document.getElementById('stat-new').textContent   = allJobs.filter((j) => j.user_status === 'new').length;
    document.getElementById('stat-total').textContent = allJobs.length;

    const maxSeen = allJobs.reduce((max, j) => {
        const d = j.last_seen_at || j.scraped_at || '';
        return d > max ? d : max;
    }, '');
    document.getElementById('last-scraped').textContent =
        maxSeen ? `Last scraped: ${maxSeen.slice(0, 16).replace('T', ' ')}` : '';
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderTable(jobs) {
    const tbody = document.getElementById('job-rows');
    if (jobs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty">No jobs match the current filters.</td></tr>';
        return;
    }
    tbody.innerHTML = jobs.map(renderRow).join('');
    tbody.querySelectorAll('.status-select').forEach((el) => {
        el.addEventListener('change', handleStatusChange);
    });
}

function renderRow(job) {
    const isNew = job.user_status === 'new';
    const opts  = STATUSES.map((s) =>
        `<option value="${s}"${job.user_status === s ? ' selected' : ''}>${STATUS_LABEL[s]}</option>`
    ).join('');
    return `
<tr class="${isNew ? 'is-new' : ''}">
  <td>
    <select class="status-select" data-status="${escapeAttr(job.user_status)}"
            data-link="${escapeAttr(job.job_link)}">
      ${opts}
    </select>
  </td>
  <td>
    <a class="job-title-link" href="${escapeAttr(job.job_link)}" target="_blank" rel="noopener noreferrer">
      ${escapeHtml(job.job_title)}
    </a>
  </td>
  <td class="company">${escapeHtml(job.company_name)}</td>
  <td class="location">${escapeHtml(job.location || '')}</td>
  <td class="date ${isToday(job.posting_date) ? 'today' : ''}">${escapeHtml(formatDate(job.posting_date))}</td>
</tr>`;
}

// ── Status change ─────────────────────────────────────────────────────────────

async function handleStatusChange(e) {
    const el         = e.currentTarget;
    const jobLink    = el.dataset.link;
    const prevStatus = el.dataset.status;
    const nextStatus = el.value;

    el.dataset.status = nextStatus;
    const row = el.closest('tr');
    row.classList.toggle('is-new', nextStatus === 'new');
    const job = allJobs.find((j) => j.job_link === jobLink);
    if (job) job.user_status = nextStatus;
    updateStats();

    try {
        const res = await fetch('/jobs/status', {
            method:  'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ job_link: jobLink, status: nextStatus }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
        el.value          = prevStatus;
        el.dataset.status = prevStatus;
        row.classList.toggle('is-new', prevStatus === 'new');
        if (job) job.user_status = prevStatus;
        updateStats();
    }
}

// ── Filter wiring ─────────────────────────────────────────────────────────────

function wireFilters() {
    // Search — debounced 200ms
    let debounce;
    document.getElementById('search').addEventListener('input', (e) => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
            filters.search = e.target.value.toLowerCase();
            renderTable(applyFilters());
        }, 200);
    });

    // Status pills
    document.querySelectorAll('[data-status-filter]').forEach((el) => {
        el.addEventListener('click', () => {
            filters.status = el.dataset.statusFilter;
            document.querySelectorAll('[data-status-filter]').forEach((p) => {
                p.classList.toggle('active', p === el);
            });
            renderTable(applyFilters());
        });
    });

    // Column sort
    document.querySelectorAll('th[data-col]').forEach((th) => {
        th.addEventListener('click', () => {
            const col = th.dataset.col;
            if (filters.sortCol === col) {
                filters.sortDir = filters.sortDir === 'asc' ? 'desc' : 'asc';
            } else {
                filters.sortCol = col;
                filters.sortDir = 'asc';
            }
            syncSortHeaders();
            renderTable(applyFilters());
        });
    });
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
    return String(str ?? '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function isToday(dateStr) {
    if (!dateStr) return false;
    return String(dateStr).startsWith(new Date().toISOString().split('T')[0]);
}

function formatDate(dateStr) {
    if (!dateStr) return '—';
    if (isToday(dateStr)) return 'Today';
    return String(dateStr).slice(0, 10);
}

// ── Entry point ───────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
