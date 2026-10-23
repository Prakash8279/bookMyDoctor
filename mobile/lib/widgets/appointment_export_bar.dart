import 'package:flutter/material.dart';
import '../core/api_client.dart';
import '../core/csv_export.dart';
import '../core/india_time.dart';
import '../models/clinical_models.dart';
import 'common_widgets.dart';

/// Same today/start/end export workflow as the website's staff appointment table.
class AppointmentExportBar extends StatefulWidget {
  const AppointmentExportBar({super.key});
  @override
  State<AppointmentExportBar> createState() => _AppointmentExportBarState();
}

class _AppointmentExportBarState extends State<AppointmentExportBar> {
  String _from = indiaToday();
  String _to = indiaToday();
  bool _exporting = false;
  Future<void> _pick(bool start) async {
    final today = DateTime.parse(indiaToday());
    final date = await showDatePicker(
        context: context,
        initialDate: DateTime.parse(start ? _from : _to),
        firstDate: DateTime(2000),
        lastDate: DateTime(today.year + 5, 12, 31));
    if (date == null || !mounted) return;
    final value =
        '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';
    setState(() {
      if (start) {
        _from = value;
      } else {
        _to = value;
      }
    });
  }

  Future<void> _export() async {
    if (_exporting || _from.compareTo(_to) > 0) return;
    setState(() => _exporting = true);
    try {
      final from = _from;
      final to = _to;
      final response = await ApiClient.instance
          .getAll('/appointments', query: {'dateFrom': from, 'dateTo': to});
      final appointments = response.list
          .map(Appointment.fromJson)
          .where((appointment) =>
              appointment.appointmentDate.compareTo(from) >= 0 &&
              appointment.appointmentDate.compareTo(to) <= 0)
          .toList();
      if (appointments.isEmpty) {
        if (mounted) {
          showSuccessSnack(context, 'No appointments in this date range.');
        }
        return;
      }
      await shareCsv(
          filename: 'appointments-$from-to-$to.csv',
          headers: const [
            'Booking ID',
            'Booked on (IST)',
            'Token',
            'Visit date',
            'Visit time',
            'Doctor',
            'Patient',
            'Phone',
            'Clinic',
            'Status',
            'Payment',
            'Consultation fee',
            'Due',
            'Notes'
          ],
          rows: appointments
              .map((appointment) => [
                    appointment.id,
                    indiaTimestamp(appointment.createdAt),
                    appointment.tokenNumber,
                    appointment.appointmentDate,
                    appointment.displayTime,
                    appointment.doctor?.name,
                    appointment.familyMember?.name ?? appointment.patient?.name,
                    appointment.patient?.phone,
                    appointment.clinic?.name,
                    appointment.status,
                    appointment.paymentStatus,
                    appointment.fees.consultationFee,
                    appointment.fees.due,
                    appointment.reason ?? appointment.notes,
                  ])
              .toList());
    } catch (error) {
      if (mounted) showErrorSnack(context, error);
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
  }

  @override
  Widget build(BuildContext context) => Card(
      child: Padding(
          padding: const EdgeInsets.all(10),
          child: Column(children: [
            Row(children: [
              const Expanded(
                  child: Text('Export appointments',
                      style: TextStyle(
                          fontWeight: FontWeight.w600, fontSize: 13))),
              TextButton(
                  onPressed: _exporting
                      ? null
                      : () => setState(() {
                            _from = indiaToday();
                            _to = indiaToday();
                          }),
                  child: const Text('Today')),
              IconButton(
                  tooltip: 'Download CSV',
                  onPressed:
                      _exporting || _from.compareTo(_to) > 0 ? null : _export,
                  icon: _exporting
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.download_outlined)),
            ]),
            Row(children: [
              Expanded(
                  child: OutlinedButton(
                      style: OutlinedButton.styleFrom(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 6, vertical: 8),
                          minimumSize: const Size(0, 36)),
                      onPressed: _exporting ? null : () => _pick(true),
                      child: Text('From $_from',
                          style: const TextStyle(fontSize: 11)))),
              const SizedBox(width: 6),
              Expanded(
                  child: OutlinedButton(
                      style: OutlinedButton.styleFrom(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 6, vertical: 8),
                          minimumSize: const Size(0, 36)),
                      onPressed: _exporting ? null : () => _pick(false),
                      child: Text('To $_to',
                          style: const TextStyle(fontSize: 11)))),
            ]),
            if (_from.compareTo(_to) > 0)
              const Text('Start date must be on or before end date.'),
          ])));
}
