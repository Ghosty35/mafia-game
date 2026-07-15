import { renderSingleCrime } from '../renderSingleCrime';

// Legacy URL slug — the crime itself is keyed 'warehouse_heist' in the DB.
export default async function BankHeistPage() {
  return renderSingleCrime('warehouse_heist');
}
