import ExcelJS from 'exceljs';
import type { ReportExcelInput } from './reportExcelTypes';
import { depositStatusLabel } from './depositStatus';
import { toNumber } from './format';

const TITLE_FILL = '147C74';
const SECTION_FILL = 'C9F3EA';
const WHITE = 'FFFFFF';
const TEXT_DARK = '1F2937';
const BORDER = 'D6DFE7';
const GREEN_SOFT = 'DCFCE7';
const RED_SOFT = 'FEE2E2';
const YELLOW_SOFT = 'FEF3C7';
const BLUE_SOFT = 'DBEAFE';

function periodLabel(filterYear: string) {
  return filterYear === 'all' ? 'Semua Periode' : `Tahun ${filterYear}`;
}

function moneyFormat() {
  return '"Rp" #,##0;[Red]-"Rp" #,##0';
}

function dateValue(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function monthDate(year: number, month: number) {
  return new Date(year, month - 1, 1);
}

function styleTitleRow(worksheet: ExcelJS.Worksheet, range: string, title: string) {
  worksheet.mergeCells(range);
  const cell = worksheet.getCell(range.split(':')[0]);
  cell.value = title;
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TITLE_FILL } };
  cell.font = { bold: true, color: { argb: WHITE }, size: 18 };
  cell.alignment = { horizontal: 'center', vertical: 'middle' };
  worksheet.getRow(Number(cell.row)).height = 30;
}

function styleSectionRow(worksheet: ExcelJS.Worksheet, range: string, title: string) {
  worksheet.mergeCells(range);
  const cell = worksheet.getCell(range.split(':')[0]);
  cell.value = title;
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SECTION_FILL } };
  cell.font = { bold: true, color: { argb: '134E4A' }, size: 12 };
  cell.alignment = { vertical: 'middle' };
  worksheet.getRow(Number(cell.row)).height = 23;
}

function styleHeader(row: ExcelJS.Row) {
  row.height = 25;
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TITLE_FILL } };
    cell.font = { bold: true, color: { argb: WHITE } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: BORDER } },
      left: { style: 'thin', color: { argb: BORDER } },
      bottom: { style: 'thin', color: { argb: BORDER } },
      right: { style: 'thin', color: { argb: BORDER } }
    };
  });
}

function styleBodyRange(worksheet: ExcelJS.Worksheet, startRow: number, endRow: number, startCol: number, endCol: number) {
  for (let rowNumber = startRow; rowNumber <= endRow; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    for (let col = startCol; col <= endCol; col += 1) {
      const cell = row.getCell(col);
      cell.font = { color: { argb: TEXT_DARK }, size: 10 };
      cell.alignment = { vertical: 'middle', wrapText: true };
      cell.border = {
        top: { style: 'thin', color: { argb: BORDER } },
        left: { style: 'thin', color: { argb: BORDER } },
        bottom: { style: 'thin', color: { argb: BORDER } },
        right: { style: 'thin', color: { argb: BORDER } }
      };
    }
  }
}

function safeFilename(filterYear: string) {
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `Jejak-Kita-${filterYear === 'all' ? 'Semua-Periode' : filterYear}-${stamp}.xlsx`;
}

export async function buildReportExcel(input: ReportExcelInput) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Kakak & Mpip';
  workbook.lastModifiedBy = 'Kakak & Mpip';
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.subject = 'Jejak tabungan bersama';
  workbook.title = `Jejak Kita - ${periodLabel(input.filterYear)}`;

  const filteredDeposits = input.deposits.filter((item) => input.filterYear === 'all' || item.year === Number(input.filterYear));
  const filteredMutations = input.mutations.filter((item) => input.filterYear === 'all' || new Date(`${item.mutation_date}T00:00:00`).getFullYear() === Number(input.filterYear));
  const filteredRecaps = input.recaps.filter((item) => input.filterYear === 'all' || item.year === Number(input.filterYear));
  const totalTargetMonthly = input.members.reduce((sum, member) => sum + toNumber(member.monthly_amount), 0);
  const totalDeposits = filteredDeposits.reduce((sum, item) => sum + toNumber(item.paid_amount), 0);
  const totalAdditions = filteredMutations.filter((item) => item.type === 'Tambah').reduce((sum, item) => sum + toNumber(item.amount), 0);
  const totalWithdrawals = filteredMutations.filter((item) => item.type === 'Penarikan').reduce((sum, item) => sum + toNumber(item.amount), 0);
  const latestBalance = filteredRecaps.at(-1)?.endingBalance || 0;

  const dashboard = workbook.addWorksheet('Dashboard', { views: [{ state: 'frozen', ySplit: 1 }] });
  dashboard.columns = [
    { width: 22 }, { width: 18 }, { width: 26 }, { width: 18 },
    { width: 4 }, { width: 25 }, { width: 20 }, { width: 34 }
  ];
  styleTitleRow(dashboard, 'A1:H1', 'JEJAK KITA - TABUNGAN BERSAMA');
  styleSectionRow(dashboard, 'A3:H3', 'Ringkasan Perjalanan');
  dashboard.addRows([
    ['Periode Laporan', periodLabel(input.filterYear), 'Diekspor', new Date(), null, 'Ringkasan', 'Nilai', 'Catatan'],
    ['Prinsip Setoran', '3% dari gaji masing-masing', 'Cara pandang', 'Proporsional, bukan nominal yang harus sama', null, 'Target Bulanan Bersama', totalTargetMonthly, 'Jumlah target pribadi Kakak dan Mpip'],
    ['Jumlah Anggota', input.members.length, 'Fokus laporan', 'Kekompakan memenuhi target pribadi', null, 'Total Setoran Masuk', totalDeposits, 'Nominal aktual sesuai periode'],
    [null, null, null, null, null, 'Tambah Rezeki', totalAdditions, 'Tambahan di luar setoran rutin'],
    [null, null, null, null, null, 'Kepakai Buat Kita', totalWithdrawals, 'Cerita dan kebutuhan bersama'],
    [null, null, null, null, null, 'Saldo Akhir Periode', latestBalance, 'Setoran + rezeki - kepakai']
  ]);
  dashboard.getRow(4).getCell(4).numFmt = 'dd mmmm yyyy hh:mm';
  for (let rowNumber = 5; rowNumber <= 9; rowNumber += 1) dashboard.getCell(`G${rowNumber}`).numFmt = moneyFormat();
  styleBodyRange(dashboard, 4, 9, 1, 8);
  styleSectionRow(dashboard, 'A11:H11', 'Komitmen Pribadi yang Tumbuh Bersama');
  const memberHeaderRow = dashboard.addRow(['Orang', 'Target / Bulan', 'Tanggal Gajian', 'Dasar Target', null, 'Catatan', null, null]);
  styleHeader(memberHeaderRow);
  const memberStart = dashboard.rowCount + 1;
  input.members.forEach((member) => {
    dashboard.addRow([
      member.name,
      toNumber(member.monthly_amount),
      member.payday,
      '3% dari gaji masing-masing',
      null,
      'Target berbeda bukan untuk dibandingkan; yang dilihat adalah komitmennya.',
      null,
      null
    ]);
  });
  const memberEnd = dashboard.rowCount;
  styleBodyRange(dashboard, memberStart, memberEnd, 1, 8);
  for (let rowNumber = memberStart; rowNumber <= memberEnd; rowNumber += 1) dashboard.getCell(`B${rowNumber}`).numFmt = moneyFormat();
  styleSectionRow(dashboard, `A${memberEnd + 2}:H${memberEnd + 2}`, 'Cara Membaca Laporan');
  const guideStart = memberEnd + 3;
  [
    ['1', 'Nominal Kakak dan Mpip tidak dibandingkan karena targetnya proporsional terhadap gaji.'],
    ['2', 'Kekompakan dilihat dari terpenuhi atau belum target pribadi masing-masing.'],
    ['3', 'Saldo dihitung dari setoran masuk + tambah rezeki - kepakai buat kita.'],
    ['4', 'Gunakan sheet Setoran Bulanan untuk melihat bukti realisasi per periode.'],
    ['5', 'Gunakan sheet Rekap Bulanan untuk melihat pertumbuhan saldo bersama.']
  ].forEach((row) => dashboard.addRow([row[0], row[1], null, null, null, null, null, null]));
  dashboard.mergeCells(`B${guideStart}:H${guideStart}`);
  dashboard.mergeCells(`B${guideStart + 1}:H${guideStart + 1}`);
  dashboard.mergeCells(`B${guideStart + 2}:H${guideStart + 2}`);
  dashboard.mergeCells(`B${guideStart + 3}:H${guideStart + 3}`);
  dashboard.mergeCells(`B${guideStart + 4}:H${guideStart + 4}`);
  styleBodyRange(dashboard, guideStart, guideStart + 4, 1, 8);

  const depositsSheet = workbook.addWorksheet('Setoran Bulanan', { views: [{ state: 'frozen', ySplit: 2 }] });
  depositsSheet.columns = [
    { width: 17 }, { width: 15 }, { width: 12 }, { width: 22 }, { width: 18 },
    { width: 22 }, { width: 18 }, { width: 20 }, { width: 16 }, { width: 34 }
  ];
  styleTitleRow(depositsSheet, 'A1:J1', 'JADWAL & REALISASI SETORAN BULANAN');
  const depositHeader = depositsSheet.addRow(['Bulan', 'Nama', 'Tgl Gajian', 'Jatuh Tempo Transfer', 'Nominal Wajib', 'Tanggal Transfer Aktual', 'Nominal Masuk', 'Status', 'Selisih', 'Catatan']);
  styleHeader(depositHeader);
  const sortedDeposits = [...filteredDeposits].sort((a, b) => a.year - b.year || a.month - b.month || (a.members?.name || '').localeCompare(b.members?.name || ''));
  sortedDeposits.forEach((item) => {
    depositsSheet.addRow([
      monthDate(item.year, item.month),
      item.members?.name || '-',
      item.members?.payday ?? null,
      dateValue(item.due_date),
      toNumber(item.required_amount),
      dateValue(item.actual_transfer_date),
      toNumber(item.paid_amount),
      depositStatusLabel(item.status),
      toNumber(item.paid_amount) - toNumber(item.required_amount),
      item.proof_image_url ? 'Ada bukti transfer' : null
    ]);
  });
  if (!sortedDeposits.length) depositsSheet.addRow(['Belum ada data setoran']);
  depositsSheet.getColumn(1).numFmt = 'mmmm yyyy';
  depositsSheet.getColumn(4).numFmt = 'dd mmmm yyyy';
  depositsSheet.getColumn(6).numFmt = 'dd mmmm yyyy';
  depositsSheet.getColumn(5).numFmt = moneyFormat();
  depositsSheet.getColumn(7).numFmt = moneyFormat();
  depositsSheet.getColumn(9).numFmt = moneyFormat();
  styleBodyRange(depositsSheet, 3, depositsSheet.rowCount, 1, 10);
  for (let rowNumber = 3; rowNumber <= depositsSheet.rowCount; rowNumber += 1) {
    const status = String(depositsSheet.getCell(`H${rowNumber}`).value || '');
    const statusCell = depositsSheet.getCell(`H${rowNumber}`);
    if (status === 'Terbayar') statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN_SOFT } };
    else if (status === 'Terbayar Telat') statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: YELLOW_SOFT } };
    else if (status === 'Kurang dikit') statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED_SOFT } };
    else statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE_SOFT } };
  }
  depositsSheet.autoFilter = { from: 'A2', to: 'J2' };

  const recapSheet = workbook.addWorksheet('Rekap Bulanan', { views: [{ state: 'frozen', ySplit: 2 }] });
  recapSheet.columns = [
    { width: 17 }, { width: 19 }, { width: 19 }, { width: 18 }, { width: 20 },
    { width: 19 }, { width: 20 }, { width: 34 }
  ];
  styleTitleRow(recapSheet, 'A1:H1', 'REKAP BULANAN - JEJAK KITA');
  const recapHeader = recapSheet.addRow(['Bulan', 'Target Setoran', 'Setoran Masuk', 'Tambah Rezeki', 'Kepakai Buat Kita', 'Saldo Akhir', 'Progress Bersama', 'Catatan']);
  styleHeader(recapHeader);
  filteredRecaps.forEach((item) => {
    const monthDeposits = filteredDeposits.filter((deposit) => deposit.year === item.year && deposit.month === item.month);
    const required = monthDeposits.reduce((sum, deposit) => sum + toNumber(deposit.required_amount), 0);
    const progress = required > 0 ? Math.min(item.totalPaidDeposits / required, 1) : 0;
    const completeTogether = input.members.length > 0 && input.members.every((member) => {
      const deposit = monthDeposits.find((entry) => entry.member_id === member.id);
      return Boolean(deposit && toNumber(deposit.paid_amount) >= toNumber(deposit.required_amount));
    });
    recapSheet.addRow([
      monthDate(item.year, item.month),
      required,
      item.totalPaidDeposits,
      item.additions,
      item.withdrawals,
      item.endingBalance,
      progress,
      completeTogether ? 'Lengkap bersama ❤️' : 'Masih dalam perjalanan'
    ]);
  });
  if (!filteredRecaps.length) recapSheet.addRow(['Belum ada data rekap']);
  recapSheet.getColumn(1).numFmt = 'mmmm yyyy';
  for (const col of [2, 3, 4, 5, 6]) recapSheet.getColumn(col).numFmt = moneyFormat();
  recapSheet.getColumn(7).numFmt = '0.00%';
  styleBodyRange(recapSheet, 3, recapSheet.rowCount, 1, 8);
  recapSheet.autoFilter = { from: 'A2', to: 'H2' };

  const storySheet = workbook.addWorksheet('Cerita', { views: [{ state: 'frozen', ySplit: 2 }] });
  storySheet.columns = [{ width: 18 }, { width: 22 }, { width: 18 }, { width: 48 }, { width: 16 }, { width: 24 }];
  styleTitleRow(storySheet, 'A1:F1', 'CERITA KITA - TAMBAH REZEKI & MOMEN BERSAMA');
  const storyHeader = storySheet.addRow(['Tanggal', 'Jenis Cerita', 'Nominal', 'Cerita / Keterangan', 'Jumlah Foto', 'Catatan']);
  styleHeader(storyHeader);
  [...filteredMutations].sort((a, b) => a.mutation_date.localeCompare(b.mutation_date)).forEach((item) => {
    storySheet.addRow([
      dateValue(item.mutation_date),
      item.type === 'Tambah' ? 'Tambah rezeki' : 'Kepakai buat kita',
      toNumber(item.amount),
      item.description || '-',
      input.photoCounts[item.id] || 0,
      input.photoCounts[item.id] ? 'Tersimpan di album Cerita' : null
    ]);
  });
  if (!filteredMutations.length) storySheet.addRow(['Belum ada cerita']);
  storySheet.getColumn(1).numFmt = 'dd mmmm yyyy';
  storySheet.getColumn(3).numFmt = moneyFormat();
  styleBodyRange(storySheet, 3, storySheet.rowCount, 1, 6);
  storySheet.autoFilter = { from: 'A2', to: 'F2' };

  const guideSheet = workbook.addWorksheet('Panduan');
  guideSheet.columns = [{ width: 23 }, { width: 33 }, { width: 44 }, { width: 34 }, { width: 24 }, { width: 38 }];
  styleTitleRow(guideSheet, 'A1:F1', 'PANDUAN JEJAK TABUNGAN BERSAMA');
  guideSheet.addRow([]);
  const guideHeader = guideSheet.addRow(['Bagian', 'Logic', 'Kenapa Begini', 'Yang Dicatat', 'Sheet', 'Catatan']);
  styleHeader(guideHeader);
  const guideRows = [
    ['Setoran', '3% dari gaji masing-masing', 'Adil karena proporsional terhadap penghasilan, bukan dipaksa sama nominal', 'Target pribadi jika berubah', 'Dashboard', 'Nominal berbeda tidak berarti kontribusi salah satu lebih kecil'],
    ['Kekompakan', 'Target pribadi masing-masing terpenuhi', 'Fokus pada komitmen bersama tanpa ranking atau perbandingan', 'Tanggal dan nominal transfer', 'Setoran Bulanan', 'Bulan lengkap jika target Kakak dan Mpip sama-sama terpenuhi'],
    ['Saldo', 'Setoran + tambah rezeki - kepakai buat kita', 'Menunjukkan pertumbuhan dana bersama secara transparan', 'Cerita uang masuk/keluar', 'Rekap Bulanan', 'Saldo akhir bersifat kumulatif'],
    ['Cerita', 'Setiap momen dapat memiliki nominal dan album foto', 'Keuangan bersama tetap punya konteks dan kenangan', 'Tanggal, nominal, cerita, foto', 'Cerita', 'Album maksimal 10 foto per cerita'],
    ['Review', 'Lihat laporan secara bulanan atau tahunan', 'Memudahkan evaluasi tanpa membuat suasana kompetitif', 'Tidak ada input manual', 'Rekap Bulanan', 'Gunakan filter untuk memilih periode']
  ];
  guideRows.forEach((row) => guideSheet.addRow(row));
  styleBodyRange(guideSheet, 4, guideSheet.rowCount, 1, 6);

  [dashboard, depositsSheet, recapSheet, storySheet, guideSheet].forEach((worksheet) => {
    worksheet.pageSetup = {
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 }
    };
    worksheet.properties.defaultRowHeight = 20;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return { buffer, filename: safeFilename(input.filterYear) };
}
