import 'package:flutter/material.dart';
import '../../core/api_client.dart';
import '../../core/india_time.dart';
import '../../models/clinical_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// Mirrors the website's today-only, payment-gated patient arrival workflow.
class ReceptionistCheckinScreen extends StatefulWidget {
  const ReceptionistCheckinScreen({super.key});
  @override
  State<ReceptionistCheckinScreen> createState() =>
      _ReceptionistCheckinScreenState();
}

class _ReceptionistCheckinScreenState extends State<ReceptionistCheckinScreen> {
  late Future<List<Appointment>> _future = _fetch();
  final _search = TextEditingController();
  String? _busyId;
  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<List<Appointment>> _fetch() async {
    final today = indiaToday();
    final response = await ApiClient.instance
        .getAll('/appointments', query: {'date': today});
    return response.list
        .map(Appointment.fromJson)
        .where((appointment) =>
            appointment.appointmentDate == today &&
            ['upcoming', 'confirmed'].contains(appointment.status) &&
            appointment.canStartClinicActions &&
            appointment.tokenNumber != null)
        .toList();
  }

  Future<void> _refresh() async {
    final pending = _fetch();
    setState(() {
      _future = pending;
    });
    try {
      await pending;
    } catch (_) {/* FutureBuilder displays this load error. */}
  }

  Future<void> _arrive(Appointment appointment) async {
    if (_busyId != null ||
        !appointment.canStartClinicActions ||
        appointment.appointmentDate != indiaToday() ||
        appointment.checkedInAt != null) {
      return;
    }
    setState(() => _busyId = appointment.id);
    try {
      await ApiClient.instance.post('/appointments/${appointment.id}/check-in');
      if (mounted) await _refresh();
    } catch (error) {
      if (mounted) showErrorSnack(context, error);
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  @override
  Widget build(BuildContext context) => RefreshIndicator(
        onRefresh: _refresh,
        child:
            ListView(padding: const EdgeInsets.all(AppSpacing.md), children: [
          PageHeader(
              title: 'Patient check-in',
              subtitle:
                  "Mark arrival for today's issued tokens. Consultation completion remains in Queue monitor.",
              action: TextButton(
                  onPressed: () async {
                    try {
                      await _refresh();
                    } catch (_) {}
                  },
                  child: const Text('Refresh'))),
          TextField(
              controller: _search,
              decoration: const InputDecoration(
                  labelText: 'Search patient, phone or token'),
              onChanged: (_) => setState(() {})),
          const SizedBox(height: AppSpacing.md),
          FutureBuilder<List<Appointment>>(
              future: _future,
              builder: (context, snapshot) {
                if (snapshot.connectionState != ConnectionState.done) {
                  return const LoadingView();
                }
                if (snapshot.hasError) {
                  return ErrorBanner(
                      error: snapshot.error!,
                      onRetry: () async {
                        try {
                          await _refresh();
                        } catch (_) {}
                      });
                }
                final query = _search.text.trim().toLowerCase();
                final appointments = (snapshot.data ?? [])
                    .where((appointment) =>
                        '${appointment.patient?.name ?? ''} ${appointment.familyMember?.name ?? ''} ${appointment.patient?.phone ?? ''} ${appointment.tokenNumber ?? ''}'
                            .toLowerCase()
                            .contains(query))
                    .toList();
                if (appointments.isEmpty) {
                  return const EmptyStateView(
                      icon: Icons.how_to_reg_outlined,
                      title: 'No eligible arrivals today',
                      subtitle:
                          'Only active, payment-complete bookings with issued tokens appear here.');
                }
                return Column(children: [
                  for (final appointment in appointments)
                    Card(
                        child: Padding(
                      padding: const EdgeInsets.all(AppSpacing.md),
                      child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Text(
                                appointment.familyMember?.name ??
                                    appointment.patient?.name ??
                                    'Patient',
                                style: const TextStyle(
                                    fontWeight: FontWeight.w700)),
                            const SizedBox(height: 4),
                            Text(
                                '${appointment.doctor?.name ?? 'Doctor'} · ${appointment.displayTime} · Token #${appointment.tokenNumber}',
                                style: TextStyle(
                                    color: context.palette.textSecondary,
                                    fontSize: 12)),
                            const SizedBox(height: 8),
                            if (appointment.checkedInAt != null)
                              const Text('Checked in',
                                  style: TextStyle(fontWeight: FontWeight.w600))
                            else
                              Align(
                                  alignment: Alignment.centerRight,
                                  child: ElevatedButton(
                                      key: ValueKey(
                                          'check-in-${appointment.id}'),
                                      onPressed: _busyId == null
                                          ? () => _arrive(appointment)
                                          : null,
                                      child: Text(_busyId == appointment.id
                                          ? 'Saving…'
                                          : 'Check in'))),
                          ]),
                    ))
                ]);
              }),
        ]),
      );
}
