import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { exportFilename } from '../db/repo/export';
import { toCsvFile } from '../lib/csv';
import { formatMinor } from '../lib/money';
import { chartCsv } from './drill';
import { reportHtml } from './report-html';
import type { ChartSpec, ReportSpec } from './tools/types';

/**
 * Getting the assistant's work out of the app: a report as a PDF, a chart as
 * a picture or as numbers.
 *
 * Same discipline as the backup export: files go to the CACHE, because the
 * share sheet copies them wherever they are going; each destination is fresh,
 * so a second export never shares the first one's bytes; and every file is
 * checked for content before it is offered. A 0-byte PDF under a correct
 * filename is the failure that looks like success.
 */

function fresh(name: string): File {
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  return file;
}

function verified(file: File): File {
  if (!file.exists || (file.size ?? 0) <= 0) {
    throw new Error(`Wrote an empty file (${file.name}). Nothing was exported.`);
  }
  return file;
}

/** "October spending" → "october-spending", for a filename that sorts and reads. */
export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'report'
  );
}

async function share(file: File, mimeType: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: file.name });
}

/** A4 at 72 dpi — `expo-print` defaults to US Letter. */
const A4 = { width: 595, height: 842 };

export async function reportPdf(report: ReportSpec): Promise<File> {
  const printed = await Print.printToFileAsync({ html: reportHtml(report, formatMinor), ...A4 });
  const destination = fresh(exportFilename(new Date(report.generatedAt), 'pdf').replace('peace-', `peace-${slugify(report.title)}-`));
  // `move` is async. Called without the await, the share sheet would be handed
  // a file that does not exist yet — the backup export's 0-byte bug again.
  await new File(printed.uri).move(destination);
  return verified(destination);
}

export async function shareReport(report: ReportSpec): Promise<void> {
  await share(await reportPdf(report), 'application/pdf');
}

export async function shareChartCsv(chart: ChartSpec): Promise<void> {
  const file = fresh(`peace-${slugify(chart.title)}.csv`);
  file.create();
  file.write(toCsvFile(chartCsv(chart)));
  await share(verified(file), 'text/csv');
}

/** A chart already captured to a PNG by `react-native-view-shot`. */
export async function shareChartImage(uri: string, chart: ChartSpec): Promise<void> {
  const destination = fresh(`peace-${slugify(chart.title)}.png`);
  await new File(uri).move(destination);
  await share(verified(destination), 'image/png');
}
