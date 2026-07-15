import { renderSingleCrime } from '../renderSingleCrime';

export default async function SingleCrimePage({ params }: { params: { key: string } }) {
  return renderSingleCrime(params.key);
}
