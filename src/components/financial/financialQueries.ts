import { useQuery } from '@tanstack/react-query';
import { financialApi, financialReportsApi, type ChargeFilters, type ReportFilters } from '../../api/financial';
import { usePatientPickerSelection } from '../patients/patientPickerQueries';
import { appointmentsApi } from '../../api/appointments';

export function useCharges(filters: ChargeFilters) {
  return useQuery({ queryKey: ['financial-charges', 'list', filters], queryFn: () => financialApi.list(filters), retry: false });
}
export function useCharge(id: number) {
  return useQuery({ queryKey: ['financial-charges', 'detail', id], queryFn: () => financialApi.get(id),
    enabled: Number.isSafeInteger(id) && id > 0, retry: false });
}
export function usePortfolioReport(enabled: boolean) {
  return useQuery({ queryKey: ['financial-report', 'portfolio'], queryFn: () => financialReportsApi.portfolio(),
    enabled, retry: false });
}
export function useCashFlowReport(filters: ReportFilters, enabled: boolean) {
  return useQuery({ queryKey: ['financial-report', 'cash-flow', filters],
    queryFn: () => financialReportsApi.cashFlow(filters), enabled, retry: false });
}
export function useChargesReport(filters: ReportFilters, enabled: boolean) {
  return useQuery({ queryKey: ['financial-report', 'charges', filters],
    queryFn: () => financialReportsApi.charges(filters), enabled, retry: false });
}
export function useFinancialPatient(id: number | null) {
  return usePatientPickerSelection(id);
}
export function useFinancialAppointment(id: number | null) {
  return useQuery({ queryKey: ['financial-appointment', id], queryFn: () => appointmentsApi.get(id!), enabled: id !== null, retry: false });
}
