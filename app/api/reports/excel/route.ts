import { NextResponse } from 'next/server';
import type { ReportExcelInput } from '@/lib/reportExcelTypes';
import { buildReportExcel } from '@/lib/reportExcelServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isReportInput(value: unknown): value is ReportExcelInput {
  if (!value || typeof value !== 'object') return false;
  const input = value as Partial<ReportExcelInput>;
  return Array.isArray(input.members)
    && Array.isArray(input.deposits)
    && Array.isArray(input.mutations)
    && Array.isArray(input.recaps)
    && typeof input.filterYear === 'string'
    && Boolean(input.photoCounts && typeof input.photoCounts === 'object');
}

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > 5_000_000) {
      return NextResponse.json({ message: 'Data laporan terlalu besar untuk diekspor sekaligus.' }, { status: 413 });
    }

    const input: unknown = await request.json();
    if (!isReportInput(input)) {
      return NextResponse.json({ message: 'Format data laporan tidak valid.' }, { status: 400 });
    }
    if (input.members.length > 20 || input.deposits.length > 2000 || input.mutations.length > 2000 || input.recaps.length > 300) {
      return NextResponse.json({ message: 'Jumlah data laporan melewati batas ekspor.' }, { status: 413 });
    }

    const { buffer, filename } = await buildReportExcel(input);
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store'
      }
    });
  } catch (error) {
    console.error('Gagal membuat export Excel:', error);
    return NextResponse.json({ message: 'Gagal membuat file Excel. Silakan coba lagi.' }, { status: 500 });
  }
}
