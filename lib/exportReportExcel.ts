import { supabase } from '@/lib/supabase/client';
import type { ReportExcelInput } from './reportExcelTypes';

function filenameFromHeader(header: string | null) {
  if (!header) return null;
  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1]);
  const normalMatch = header.match(/filename="?([^";]+)"?/i);
  return normalMatch?.[1] || null;
}

export async function exportReportExcel(input: ReportExcelInput) {
  const { data, error } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (error || !accessToken) throw new Error('Session login tidak ditemukan. Silakan masuk ulang.');

  // Server mengambil ulang data dari Supabase berdasarkan session; payload browser tidak dipercaya.
  const response = await fetch('/api/reports/excel', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify({ filterYear: input.filterYear })
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(errorBody?.message || 'Server gagal menyiapkan file Excel.');
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filenameFromHeader(response.headers.get('Content-Disposition')) || 'Jejak-Kita.xlsx';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
