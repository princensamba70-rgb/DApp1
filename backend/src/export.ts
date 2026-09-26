import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { pool } from './db.js';
import { AppError } from './errors.js';
import { RESULT_SELECT, resultWhere, type Filters } from './routes-data.js';

type Resource = 'errors'|'results'|'statistics'|'questionnaires'|'questions'|'rules';
type Format = 'csv'|'xlsx'|'pdf';
type Row = Record<string, unknown>;
const safe = (v: unknown): string => v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
const date = (v: unknown) => v ? new Date(String(v)).toLocaleString('fr-FR',{timeZone:'Africa/Kinshasa'}) : '';
const value = (v: unknown) => v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v);

async function getRows(resource: Resource, filters: Filters): Promise<Row[]> {
  if (resource === 'errors' || resource === 'results') {
    const where = resultWhere({ ...filters, status: resource === 'errors' ? 'NON CONFORME' : filters.status });
    const data = await pool.query(`${RESULT_SELECT} ${where.sql} ORDER BY qr.checked_at DESC LIMIT 5001`,where.values);
    if (data.rows.length > 5000) throw new AppError(413,'EXPORT_TROP_GRAND','Plus de 5 000 résultats. Affinez les filtres pour exporter.');
    return data.rows.map(r => ({ 'Occurrence':r.occurrence,'Statut':r.error_type || r.status,'Détails':r.details,
      'Gravité':r.status==='NON CONFORME'?r.severity:'','Enquêteur':r.interviewer || '', 'Superviseur':r.supervisor || '',
      'Village':r.context?.village || '', 'Aire de santé':r.context?.healthArea || '', 'Zone de santé':r.context?.healthZone || '',
      'Questionnaire':r.questionnaire_title,'Entretien':r.interview_id,'Question':r.question_label,'Valeur':value(r.value),
      'Score qualité':r.quality_score, 'Classification':r.quality_class,'Entretiens associés':safe(r.related),'Date':date(r.last_modified_at) }));
  }
  if (resource === 'questionnaires') {
    const rows = await pool.query(`SELECT q.title,q.external_id,q.workspace,q.status,q.last_synced_at,
       (SELECT count(*)::int FROM questionnaire_versions v WHERE v.questionnaire_id=q.id) AS versions,
       (SELECT count(*)::int FROM survey_responses s WHERE s.questionnaire_id=q.id) AS interviews FROM questionnaires q
       WHERE ($1::uuid IS NULL OR q.id=$1) ORDER BY q.title LIMIT 5001`,[filters.questionnaireId || null]);
    return rows.rows.map(r => ({ Questionnaire:r.title,Identifiant:r.external_id,Espace:r.workspace,Versions:r.versions,Entretiens:r.interviews,Statut:r.status,'Dernière synchronisation':date(r.last_synced_at) }));
  }
  if (resource === 'questions') {
    const rows = await pool.query(`SELECT q.title,v.version,qu.variable_name,qu.label,qu.type,qu.options,qu.min_value,qu.max_value,
       qu.enabling_condition,s.title AS section_title FROM questions qu JOIN questionnaire_versions v ON v.id=qu.version_id
       JOIN questionnaires q ON q.id=v.questionnaire_id LEFT JOIN sections s ON s.id=qu.section_id
       WHERE ($1::uuid IS NULL OR q.id=$1) AND ($2::uuid IS NULL OR qu.id=$2) ORDER BY q.title,v.version,qu.position LIMIT 5001`,
       [filters.questionnaireId || null,filters.questionId || null]);
    return rows.rows.map(r => ({ Questionnaire:r.title,Version:r.version,Section:r.section_title || '',Variable:r.variable_name,
      Libellé:r.label,Type:r.type,Options:safe(r.options),Minimum:r.min_value,Maximum:r.max_value,'Condition d’activation':r.enabling_condition || '' }));
  }
  if (resource === 'rules') {
    const rows = await pool.query(`SELECT q.title,v.version,qu.variable_name,r.type,r.params,r.active,r.created_at FROM quality_rules r
      JOIN questions qu ON qu.id=r.question_id JOIN questionnaire_versions v ON v.id=qu.version_id JOIN questionnaires q ON q.id=v.questionnaire_id
      WHERE ($1::uuid IS NULL OR q.id=$1) AND ($2::uuid IS NULL OR qu.id=$2) ORDER BY q.title,qu.variable_name LIMIT 5001`,
      [filters.questionnaireId || null,filters.questionId || null]);
    return rows.rows.map(r => ({ Questionnaire:r.title,Version:r.version,Variable:r.variable_name,Contrôle:r.type,Paramètres:safe(r.params),Statut:r.active?'Actif':'Inactif',Création:date(r.created_at) }));
  }
  const data = await pool.query(`SELECT q.title,
    count(DISTINCT s.id)::int AS interviews,
    count(DISTINCT s.id) FILTER(WHERE s.status='CONFORME')::int AS compliant,
    count(DISTINCT s.id) FILTER(WHERE s.status='NON CONFORME')::int AS errors,
    count(qr.id)::int AS controls,
    count(qr.id) FILTER(WHERE qr.status='CONFORME')::int AS passed,
    count(qr.id) FILTER(WHERE qr.status='NON CONFORME')::int AS failed
    FROM questionnaires q LEFT JOIN survey_responses s ON s.questionnaire_id=q.id LEFT JOIN quality_results qr ON qr.response_id=s.id
    WHERE ($1::uuid IS NULL OR q.id=$1) GROUP BY q.id,q.title ORDER BY q.title LIMIT 5001`,[filters.questionnaireId || null]);
  return data.rows.map(r => ({ Questionnaire:r.title,Entretiens:r.interviews,Conformes:r.compliant,'Avec erreurs':r.errors,Contrôles:r.controls,Réussis:r.passed,Échoués:r.failed }));
}
function csvCell(v: unknown): string {
  let text = safe(v);
  // Evite l'injection de formules dans les tableurs (Excel, LibreOffice).
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g,'""')}"`;
}

export async function exportResource(resource: Resource, format: Format, filters: Filters) {
  const rows = await getRows(resource,filters);
  if (rows.length > 5000) throw new AppError(413,'EXPORT_TROP_GRAND','Affinez les filtres (maximum 5 000 lignes).');
  const columns = Object.keys(rows[0] || (resource === 'errors' || resource === 'results' ? {'Occurrence':'','Statut':'','Détails':'','Gravité':'','Questionnaire':''} : {'Aucune donnée':''}));
  const filename = `survey-quality-${resource}-${new Date().toISOString().slice(0,10)}.${format}`;
  if (format === 'csv') {
    const content = [columns.map(csvCell).join(';'),...rows.map(r => columns.map(k => csvCell(r[k])).join(';'))].join('\r\n');
    return { buffer:Buffer.from('\ufeff'+content+'\r\n','utf8'),mime:'text/csv; charset=utf-8',filename };
  }
  if (format === 'xlsx') {
    const book = new ExcelJS.Workbook();
    book.creator = 'SurveyQuality';
    const sheet = book.addWorksheet('Rapport qualité',{ views:[{state:'frozen',ySplit:1}] });
    sheet.columns = columns.map(k => ({ header:k,key:k,width:Math.max(18,Math.min(42,k.length+8)) }));
    sheet.getRow(1).font = { bold:true,color:{argb:'FFFFFFFF'} };
    sheet.getRow(1).fill = { type:'pattern',pattern:'solid',fgColor:{argb:'FF10273F'} };
    for (const row of rows) {
      const clean: Row = {};
      for (const c of columns) clean[c] = typeof row[c] === 'number' ? row[c] : /^[\s]*[=+\-@]/.test(safe(row[c])) ? `'${safe(row[c])}` : safe(row[c]);
      sheet.addRow(clean);
    }
    sheet.autoFilter = { from:'A1',to:{row:1,column:columns.length} };
    return { buffer:Buffer.from(await book.xlsx.writeBuffer()),mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',filename };
  }
  const buffer = await new Promise<Buffer>((resolve,reject) => {
    const doc = new PDFDocument({ size:'A4',margin:36,info:{Title:'Rapport SurveyQuality'} });
    const chunks: Buffer[] = [];
    doc.on('data',(chunk:Buffer) => chunks.push(chunk)); doc.on('end',() => resolve(Buffer.concat(chunks))); doc.on('error',reject);
    doc.fontSize(18).fillColor('#10273f').text('SurveyQuality  /  Rapport');
    doc.fontSize(9).fillColor('#66788d').text(`${resource.toUpperCase()}  ·  ${new Date().toLocaleString('fr-FR',{timeZone:'Africa/Kinshasa'})}  ·  ${rows.length} ligne(s)`);
    doc.moveDown();
    if (!rows.length) doc.fillColor('#5a6b7c').fontSize(11).text('Aucune donnée pour les filtres sélectionnés.');
    for (let i=0; i<rows.length; i++) {
      if (doc.y > 740) doc.addPage();
      doc.rect(36,doc.y,523,1).fill('#e8eef4'); doc.moveDown(0.3);
      const r = rows[i]!;
      doc.fontSize(9).fillColor('#10273f').font('Helvetica-Bold').text(`${i+1}. ${safe(r.Questionnaire || r.Variable || 'Enregistrement').slice(0,85)}`);
      doc.font('Helvetica').fontSize(8).fillColor('#4f6378');
      for (const key of columns.filter(k => !['Questionnaire','Détail','Options','Paramètres'].includes(k)).slice(0,6)) {
        doc.text(`${key}: ${safe(r[key]).slice(0,85)}`,{lineBreak:true});
      }
      if (r.Détail) doc.text(`Détail: ${safe(r.Détail).slice(0,130)}`);
      doc.moveDown(0.5);
    }
    doc.end();
  });
  return {buffer,mime:'application/pdf',filename};
}
