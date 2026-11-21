import { useParams } from 'react-router-dom'
import { PATHS } from '@/app/paths'
import { PayslipScreen } from '@/modules/hr/payroll/pages/PayslipPage'
import { useMyPayslip } from '../api'

/** `/hr/me/payslips/:id`: one of the caller's own payslips, printable; works for every role with an employee record. */
export default function MyPayslipPage() {
  const { id = '' } = useParams()
  return <PayslipScreen q={useMyPayslip(id)} backTo={PATHS.hrMe} backLabel="My HR" />
}
