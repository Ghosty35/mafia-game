import { renderSingleCrime } from '../renderSingleCrime';

export default async function SingleCrimePage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  return renderSingleCrime(key);
}
