import { figureIssues, renderFigure, type FigureDocument, type ResearchDataset } from './research-figures';

let datasets: ResearchDataset[] = [];
self.onmessage = (event: MessageEvent<{ id: number; figure: FigureDocument | null; datasets?: ResearchDataset[] }>) => {
  const { id, figure } = event.data;
  if (event.data.datasets) datasets = event.data.datasets;
  try {
    self.postMessage({ id, svg: figure ? renderFigure(figure, datasets) : '', issues: figure ? figureIssues(figure, datasets) : [], error: '' });
  } catch (error) {
    self.postMessage({ id, svg: '', issues: [], error: error instanceof Error ? error.message : 'Figure cannot be rendered.' });
  }
};
