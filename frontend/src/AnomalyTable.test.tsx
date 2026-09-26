import {afterEach,describe,it,expect} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {AnomalyTable} from './AnomalyTable';
import type {Result} from './types';
afterEach(cleanup);
describe('présentation des anomalies',()=>{
  it('affiche le constat réel, le contexte et le score sans paramètres techniques',()=>{
    const row:Result={id:'1',occurrence:9,error_type:'Village répété',details:'Le village « Kimbangu » apparaît 9 fois dans l’aire de santé « Kimputu ».',severity:'MAJEURE',context:{village:'Kimbangu',healthArea:'Kimputu'},related:[],quality_score:85,quality_class:'À surveiller',status:'NON CONFORME',value:'Kimbangu',instance_key:'',checked_at:'2026-09-26',question_id:'q',variable_name:'S00Q05',question_label:'Village',questionnaire_id:'f',questionnaire_title:'Enquête ménage',interview_id:'entretien-001',interviewer:'ENQ024',supervisor:'SUP1',last_modified_at:'2026-09-26'};
    render(<AnomalyTable items={[row]}/>);
    expect(screen.getByRole('columnheader',{name:'Occurrence'})).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
    expect(screen.getByText(row.details)).toBeInTheDocument();
    expect(screen.getByText('85 %')).toBeInTheDocument();
    expect(screen.queryByText(/Paramètres|Règle|count >|maximumOccurrences/)).not.toBeInTheDocument();
  });
});
