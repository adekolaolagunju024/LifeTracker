const ExcelJS = require('exceljs');

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D1B2A' } };
const HEADER_FONT = { color: { argb: 'FFFFFFFF' }, bold: true };

function styleHeaderRow(row) {
  row.eachCell(cell => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
  });
}

async function buildWorkbook(snapshot) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'LifeTracker';
  wb.created = new Date();

  const projectTitleById = Object.fromEntries(snapshot.projects.map(p => [p.id, p.title]));

  const tasksSheet = wb.addWorksheet('Tasks');
  tasksSheet.columns = [
    { header: 'Title', key: 'title', width: 30 },
    { header: 'Project', key: 'project', width: 20 },
    { header: 'Category', key: 'category', width: 16 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Priority', key: 'priority', width: 10 },
    { header: 'Start', key: 'startDate', width: 12 },
    { header: 'Due', key: 'endDate', width: 12 },
    { header: 'Cost', key: 'cost', width: 10 },
    { header: 'Notes', key: 'notes', width: 40 },
  ];
  snapshot.tasks.forEach(t => tasksSheet.addRow({ ...t, project: projectTitleById[t.projectId] || '' }));
  styleHeaderRow(tasksSheet.getRow(1));

  const projectsSheet = wb.addWorksheet('Projects');
  projectsSheet.columns = [
    { header: 'Title', key: 'title', width: 24 },
    { header: 'Description', key: 'description', width: 40 },
    { header: 'Icon', key: 'icon', width: 8 },
    { header: 'Color', key: 'color', width: 10 },
  ];
  snapshot.projects.forEach(p => projectsSheet.addRow(p));
  styleHeaderRow(projectsSheet.getRow(1));

  const wealthSheet = wb.addWorksheet('Wealth Log');
  wealthSheet.columns = [
    { header: 'Month', key: 'month', width: 16 },
    { header: 'Job Income', key: 'income', width: 12 },
    { header: 'Business', key: 'business', width: 12 },
    { header: 'Expenses', key: 'expenses', width: 12 },
    { header: 'Saved', key: 'saved', width: 12 },
    { header: 'Notes', key: 'notes', width: 40 },
  ];
  snapshot.wealth.monthlyLog.forEach(e => wealthSheet.addRow(e));
  styleHeaderRow(wealthSheet.getRow(1));

  return wb.xlsx.writeBuffer();
}

module.exports = { buildWorkbook };
