import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/admin_period.dart';
import '../../core/india_time.dart';
import '../../widgets/admin_period_filter.dart';
import '../../core/payment_visibility.dart';
import '../../models/clinical_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/booking_slip_sheet.dart';
import '../../widgets/common_widgets.dart';

/// Payment list + record-new flow. POST /payments is receptionist/admin/
/// superadmin only (integration_plan.md §1.12) — this is the real
/// destination for collecting cash/UPI/card at the front desk; a patient
/// can never create their own payment record. No PATCH/DELETE exists on
/// this resource, so the list is append-only.
class ReceptionistPaymentsScreen extends StatefulWidget {
  const ReceptionistPaymentsScreen({super.key});

  @override
  State<ReceptionistPaymentsScreen> createState() =>
      _ReceptionistPaymentsScreenState();
}

class _ReceptionistPaymentsScreenState
    extends State<ReceptionistPaymentsScreen> {
  Future<List<PaymentItem>>? _future;
  AdminPeriod _period = AdminPeriod.today();

  @override
  void initState() {
    super.initState();
    _future = _fetch();
  }

  Future<List<PaymentItem>> _fetch() async {
    try {
      final res =
          await ApiClient.instance.getAll('/payments', query: {'pageSize': 50});
      final list = <PaymentItem>[];
      for (final item in res.list) {
        try {
          list.add(PaymentItem.fromJson(item));
        } catch (_) {}
      }
      return list;
    } catch (_) {
      rethrow;
    }
  }

  void _load() {
    setState(() {
      _future = _fetch();
    });
  }

  Future<void> _openNew() async {
    final result = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => const _NewPaymentScreen()),
    );
    if (result == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _openNew,
        icon: const Icon(Icons.add),
        label: const Text('Record payment'),
      ),
      body: Column(
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(
                AppSpacing.md, AppSpacing.md, AppSpacing.md, 0),
            child: PageHeader(
              title: 'Payments',
              subtitle: 'Record clinic collections and review receipts.',
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
            child: AdminPeriodFilter(
                value: _period,
                onChanged: (period) => setState(() => _period = period)),
          ),
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: AppSpacing.md),
            child: Text(
                'Filtered by payment date (IST). All dates includes undated records.',
                style: TextStyle(fontSize: 11)),
          ),
          Expanded(
            child: FutureBuilder<List<PaymentItem>>(
              future: _future,
              builder: (context, snapshot) {
                if (snapshot.connectionState != ConnectionState.done) {
                  return const LoadingView();
                }
                if (snapshot.hasError) {
                  return Padding(
                      padding: const EdgeInsets.all(AppSpacing.md),
                      child:
                          ErrorBanner(error: snapshot.error!, onRetry: _load));
                }
                if (!_period.isValid) return const SizedBox.shrink();
                final payments = (snapshot.data ?? [])
                    .where((payment) => _period.includes(payment.createdAt))
                    .toList();
                if (payments.isEmpty) {
                  return const EmptyStateView(
                      icon: Icons.receipt_long_outlined,
                      title: 'No payments in selected dates');
                }
                // BUG FIX (mobile parity audit): mirrors web's CashPayment 3-way split
                // (StaffPages.jsx) — was missing entirely on mobile.
                final collected = payments
                    .where((payment) =>
                        isRevenuePayment(payment, doctorOnly: true))
                    .toList();
                final bookingPayments =
                    collected.where(isOnlineBookingPayment).toList();
                final cashPayments = collected
                    .where((p) =>
                        !isOnlineBookingPayment(p) &&
                        p.mode.toLowerCase() == 'cash')
                    .toList();
                final clinicOnlinePayments = collected
                    .where((p) =>
                        !isOnlineBookingPayment(p) &&
                        p.mode.toLowerCase() != 'cash')
                    .toList();
                double sumOf(List<PaymentItem> list) =>
                    list.fold<double>(0, (sum, p) => sum + clinicAmount(p));
                return RefreshIndicator(
                  onRefresh: () async => _load(),
                  child: ListView.separated(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    itemCount: payments.length + 1,
                    separatorBuilder: (_, __) =>
                        const SizedBox(height: AppSpacing.sm),
                    itemBuilder: (context, i) {
                      if (i == 0) {
                        return Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            StatCard(
                              label: 'PAID ONLINE AT BOOKING',
                              value:
                                  '₹${sumOf(bookingPayments).toStringAsFixed(0)}',
                              icon: Icons.public,
                              detail:
                                  '${bookingPayments.length} payment(s) · paid before arrival',
                            ),
                            const SizedBox(height: AppSpacing.sm),
                            StatCard(
                              label: 'CASH COLLECTED AT CLINIC',
                              value:
                                  '₹${sumOf(cashPayments).toStringAsFixed(0)}',
                              icon: Icons.currency_rupee,
                              detail: '${cashPayments.length} payment(s)',
                            ),
                            const SizedBox(height: AppSpacing.sm),
                            StatCard(
                              label: 'ONLINE COLLECTED AT CLINIC',
                              value:
                                  '₹${sumOf(clinicOnlinePayments).toStringAsFixed(0)}',
                              icon: Icons.wifi,
                              detail:
                                  '${clinicOnlinePayments.length} payment(s) · UPI/Card/Online',
                            ),
                          ],
                        );
                      }
                      final p = payments[i - 1];
                      return Card(
                        child: InkWell(
                          onTap: () => showPaymentReceiptSheet(context, p),
                          borderRadius: BorderRadius.circular(AppRadius.card),
                          child: Padding(
                            padding: const EdgeInsets.all(AppSpacing.sm),
                            child: Column(
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: [
                                  Text(
                                      p.patient?.patientDisplayName ??
                                          'Patient',
                                      style: const TextStyle(
                                          fontWeight: FontWeight.w700)),
                                  const SizedBox(height: 4),
                                  Wrap(
                                      spacing: 10,
                                      runSpacing: 4,
                                      crossAxisAlignment:
                                          WrapCrossAlignment.center,
                                      children: [
                                        if (p.fees.consultationFee != null ||
                                            p.fees.amount != null)
                                          Text(
                                              '₹${(p.fees.amount ?? p.fees.consultationFee)!.toStringAsFixed(0)}',
                                              style: const TextStyle(
                                                  fontWeight: FontWeight.w700,
                                                  fontSize: 15)),
                                        StatusBadge(status: p.status),
                                      ]),
                                  const SizedBox(height: 4),
                                  Text(
                                      '${p.doctor?.doctorDisplayName ?? "Doctor"} · ${p.mode.toUpperCase()}${p.receiptNumber != null ? " · #${p.receiptNumber}" : ""}'),
                                  if (p.appointment?.id != null &&
                                      p.appointment!.id.isNotEmpty)
                                    Text(
                                        'Booking ID: #${p.appointment!.id.length > 8 ? p.appointment!.id.substring(0, 8) : p.appointment!.id}',
                                        style: const TextStyle(fontSize: 11)),
                                  Text(
                                      'Payment date: ${indiaTimestamp(p.createdAt)}',
                                      style: const TextStyle(fontSize: 11)),
                                  Align(
                                    alignment: Alignment.centerLeft,
                                    child: TextButton.icon(
                                        onPressed: () =>
                                            showPaymentReceiptSheet(context, p),
                                        icon: const Icon(
                                            Icons.receipt_long_outlined,
                                            size: 16),
                                        label: const Text('View receipt')),
                                  ),
                                ]),
                          ),
                        ),
                      );
                    },
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _NewPaymentScreen extends StatefulWidget {
  const _NewPaymentScreen();

  @override
  State<_NewPaymentScreen> createState() => _NewPaymentScreenState();
}

class _NewPaymentScreenState extends State<_NewPaymentScreen> {
  Future<List<Appointment>>? _appointmentsFuture;
  Appointment? _selectedAppointment;
  String _mode = 'cash';
  final _transactionRefCtrl = TextEditingController();
  final _payerUpiIdCtrl = TextEditingController();
  bool _submitting = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _appointmentsFuture = ApiClient.instance
        .getAll('/appointments', query: {'pageSize': 100}).then((res) {
      final list = <Appointment>[];
      for (final item in res.list) {
        try {
          final a = Appointment.fromJson(item);
          if (!['cancelled', 'no_show', 'pending_payment'].contains(a.status) &&
              ['pending', 'partial'].contains(a.paymentStatus) &&
              (a.fees.due ?? a.fees.consultationFee ?? 0) > 0) {
            list.add(a);
          }
        } catch (_) {}
      }
      return list;
    });
  }

  @override
  void dispose() {
    _transactionRefCtrl.dispose();
    _payerUpiIdCtrl.dispose();
    super.dispose();
  }

  String _appointmentLabel(Appointment appointment) {
    final id = appointment.id.length > 8
        ? appointment.id.substring(0, 8)
        : appointment.id;
    final patient = appointment.familyMember?.name ??
        appointment.patient?.name ??
        'Patient';
    final token = appointment.tokenNumber == null
        ? 'Token not assigned'
        : 'Token #${appointment.tokenNumber}';
    return '#$id · $patient · $token';
  }

  Future<void> _pickAppointment(List<Appointment> appointments) async {
    final picked = await showModalBottomSheet<Appointment>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) => _AppointmentPicker(
        appointments: appointments,
        labelFor: _appointmentLabel,
      ),
    );
    if (picked != null && mounted) {
      setState(() => _selectedAppointment = picked);
    }
  }

  Future<void> _submit() async {
    if (_selectedAppointment == null) {
      setState(() => _error = 'Select an appointment');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await ApiClient.instance.post('/payments', body: {
        'appointmentId': _selectedAppointment!.id,
        'mode': _mode,
        // BUG FIX: the UTR/Transaction number field is always visible now (see the
        // COMPLETENESS FIX comment below), but this used to only send it when mode != 'cash' —
        // so a UTR typed in for a cash payment was silently dropped instead of saved. Mirrors
        // web's CashPayment, which sends transactionRef whenever it's non-empty, regardless of
        // mode — same conditional-inclusion pattern as payerUpiId right below.
        if (_transactionRefCtrl.text.trim().isNotEmpty)
          'transactionRef': _transactionRefCtrl.text.trim(),
        // COMPLETENESS ADD — mirrors web's CashPayment (StaffPages.jsx): a "UPI ID" field
        // that's always available regardless of payment method and gets saved alongside
        // the UTR/transaction reference above.
        if (_payerUpiIdCtrl.text.trim().isNotEmpty)
          'payerUpiId': _payerUpiIdCtrl.text.trim(),
      });
      if (mounted) Navigator.of(context).pop(true);
    } catch (err) {
      if (!mounted) return;
      setState(() {
        _error = err.toString();
        _submitting = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Record payment')),
      body: ListView(
        padding: const EdgeInsets.all(AppSpacing.md),
        children: [
          if (_error != null) ...[
            ErrorBanner(error: _error!),
            const SizedBox(height: AppSpacing.md)
          ],
          FutureBuilder<List<Appointment>>(
            future: _appointmentsFuture,
            builder: (context, snapshot) {
              if (snapshot.connectionState != ConnectionState.done) {
                return const LoadingView();
              }
              if (snapshot.hasError) return ErrorBanner(error: snapshot.error!);
              final appts = snapshot.data ?? [];
              if (appts.isEmpty) {
                return Text('No appointments with pending payment right now.',
                    style: TextStyle(color: context.palette.textSecondary));
              }
              return InkWell(
                key: const ValueKey('unpaid-appointment-picker'),
                onTap: () => _pickAppointment(appts),
                borderRadius: BorderRadius.circular(AppRadius.button),
                child: InputDecorator(
                  decoration: const InputDecoration(
                    labelText: 'Appointment (payment pending)',
                    suffixIcon: Icon(Icons.search),
                  ),
                  child: Text(
                    _selectedAppointment == null
                        ? 'Search by name, booking ID or token'
                        : _appointmentLabel(_selectedAppointment!),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: _selectedAppointment == null
                          ? context.palette.textSecondary
                          : context.palette.textPrimary,
                    ),
                  ),
                ),
              );
            },
          ),
          // DUE-AMOUNT VISIBILITY FIX (user request: "jab payment minimum hua hai to receptionist
          // ko v to baki ka due show hoga aur doctor ko") — this used to show only a vague
          // "advance already paid, collecting the remaining balance now" sentence for a partial
          // appointment, with NO number at all, since a receptionist only ever saw
          // `fees.consultationFee`. The server now also sends a single, already-contextual
          // `fees.due` figure (see appointments.service.js#shapeFees) — the doctor's own
          // outstanding share once a minimum-only payment was made online, without leaking any of
          // the masked platform-business fields — so the exact amount to collect is shown here.
          if (_selectedAppointment != null) ...[
            const SizedBox(height: AppSpacing.md),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(AppSpacing.md),
              decoration: BoxDecoration(
                color: context.palette.background,
                borderRadius: BorderRadius.circular(AppRadius.button),
                border: Border.all(color: context.palette.border),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Consultation fee: ₹${_selectedAppointment!.fees.consultationFee?.toStringAsFixed(0) ?? 0}',
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _selectedAppointment!.paymentStatus == 'partial'
                        ? 'An advance has already been paid online for this appointment — Due now: ₹${(_selectedAppointment!.fees.due ?? _selectedAppointment!.fees.consultationFee)?.toStringAsFixed(0) ?? 0} collected at the clinic.'
                        : 'Paid so far: ₹0 · Due now: ₹${(_selectedAppointment!.fees.due ?? _selectedAppointment!.fees.consultationFee)?.toStringAsFixed(0) ?? 0}',
                    style: TextStyle(
                        color: context.palette.textSecondary, fontSize: 12),
                  ),
                ],
              ),
            ),
          ],
          const SizedBox(height: AppSpacing.md),
          DropdownButtonFormField<String>(
            initialValue: _mode,
            decoration: const InputDecoration(labelText: 'Payment mode'),
            items: const [
              DropdownMenuItem(value: 'cash', child: Text('Cash')),
              DropdownMenuItem(value: 'upi', child: Text('UPI')),
              DropdownMenuItem(value: 'card', child: Text('Card')),
              DropdownMenuItem(value: 'online', child: Text('Online')),
            ],
            onChanged: (v) => setState(() => _mode = v ?? 'cash'),
          ),
          // COMPLETENESS FIX — mirrors web's CashPayment: "UTR / Transaction number" and "UPI ID"
          // are ALWAYS visible regardless of payment method (not just for non-cash), and both get
          // saved. (Previously the transaction reference field only appeared for non-cash modes,
          // and there was no UPI ID field at all.)
          const SizedBox(height: AppSpacing.md),
          TextField(
            controller: _transactionRefCtrl,
            decoration: const InputDecoration(
                labelText: 'UTR / Transaction number',
                hintText: 'Bank/UPI reference number'),
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(
            controller: _payerUpiIdCtrl,
            decoration: const InputDecoration(
                labelText: 'UPI ID', hintText: 'e.g. name@okhdfcbank'),
          ),
          const SizedBox(height: AppSpacing.lg),
          PrimaryButton(
              label: 'Record payment',
              onPressed: _submit,
              loading: _submitting),
        ],
      ),
    );
  }
}

class _AppointmentPicker extends StatefulWidget {
  final List<Appointment> appointments;
  final String Function(Appointment appointment) labelFor;

  const _AppointmentPicker({
    required this.appointments,
    required this.labelFor,
  });

  @override
  State<_AppointmentPicker> createState() => _AppointmentPickerState();
}

class _AppointmentPickerState extends State<_AppointmentPicker> {
  final _searchController = TextEditingController();
  String _query = '';

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final query = _query.trim().toLowerCase();
    final matches = widget.appointments.where((appointment) {
      final searchable = [
        appointment.id,
        appointment.patient?.name,
        appointment.familyMember?.name,
        appointment.tokenNumber?.toString(),
      ].whereType<String>().join(' ').toLowerCase();
      return query.isEmpty || searchable.contains(query);
    }).toList();

    return FractionallySizedBox(
      heightFactor: 0.78,
      child: Padding(
        padding: EdgeInsets.fromLTRB(
          AppSpacing.md,
          AppSpacing.md,
          AppSpacing.md,
          MediaQuery.viewInsetsOf(context).bottom + AppSpacing.sm,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Select unpaid appointment',
                style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: AppSpacing.sm),
            TextField(
              controller: _searchController,
              autofocus: true,
              decoration: const InputDecoration(
                labelText: 'Search unpaid appointments',
                hintText: 'Patient name, booking ID or token number',
                prefixIcon: Icon(Icons.search),
              ),
              onChanged: (value) => setState(() => _query = value),
            ),
            const SizedBox(height: AppSpacing.sm),
            Expanded(
              child: matches.isEmpty
                  ? const Center(child: Text('No matching appointments.'))
                  : ListView.separated(
                      itemCount: matches.length,
                      separatorBuilder: (_, __) => const Divider(height: 1),
                      itemBuilder: (context, index) {
                        final appointment = matches[index];
                        final due = appointment.fees.due ??
                            appointment.fees.consultationFee ??
                            0;
                        return ListTile(
                          key:
                              ValueKey('payment-appointment-${appointment.id}'),
                          title: Text(widget.labelFor(appointment)),
                          subtitle: Text('Due ₹${due.toStringAsFixed(0)}'),
                          onTap: () => Navigator.of(context).pop(appointment),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
