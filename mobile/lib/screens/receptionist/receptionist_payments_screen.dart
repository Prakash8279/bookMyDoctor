import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../models/clinical_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// Payment list + record-new flow. POST /payments is receptionist/admin/
/// superadmin only (integration_plan.md §1.12) — this is the real
/// destination for collecting cash/UPI/card at the front desk; a patient
/// can never create their own payment record. No PATCH/DELETE exists on
/// this resource, so the list is append-only.
class ReceptionistPaymentsScreen extends StatefulWidget {
  const ReceptionistPaymentsScreen({super.key});

  @override
  State<ReceptionistPaymentsScreen> createState() => _ReceptionistPaymentsScreenState();
}

class _ReceptionistPaymentsScreenState extends State<ReceptionistPaymentsScreen> {
  Future<List<PaymentItem>>? _future;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    setState(() {
      _future = ApiClient.instance
          .get('/payments', query: {'pageSize': 50})
          .then((res) => res.list.map(PaymentItem.fromJson).toList());
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
            padding: EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, 0),
            child: PageHeader(
              title: 'Payments',
              subtitle: 'Record clinic collections and review receipts.',
            ),
          ),
          Expanded(
            child: FutureBuilder<List<PaymentItem>>(
              future: _future,
              builder: (context, snapshot) {
                if (snapshot.connectionState != ConnectionState.done) return const LoadingView();
                if (snapshot.hasError) {
                  return Padding(padding: const EdgeInsets.all(AppSpacing.md), child: ErrorBanner(error: snapshot.error!, onRetry: _load));
                }
                final payments = snapshot.data ?? [];
                if (payments.isEmpty) {
                  return const EmptyStateView(icon: Icons.receipt_long_outlined, title: 'No payments recorded yet');
                }
                return RefreshIndicator(
                  onRefresh: () async => _load(),
                  child: ListView.separated(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    itemCount: payments.length,
              separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
              itemBuilder: (context, i) {
                final p = payments[i];
                return Card(
                  child: ListTile(
                    title: Text(p.patient?.name ?? 'Patient'),
                    subtitle: Text(
                      'Dr. ${p.doctor?.name ?? "—"} · ${p.mode.toUpperCase()}${p.receiptNumber != null ? " · #${p.receiptNumber}" : ""}',
                    ),
                    trailing: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        if (p.fees.consultationFee != null)
                          Text('₹${p.fees.consultationFee!.toStringAsFixed(0)}', style: const TextStyle(fontWeight: FontWeight.w700)),
                        StatusBadge(status: p.status),
                      ],
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
        .get('/appointments', query: {'pageSize': 100})
        .then((res) => res.list.map(Appointment.fromJson).toList().where((a) => a.paymentStatus == 'pending').toList());
  }

  @override
  void dispose() {
    _transactionRefCtrl.dispose();
    _payerUpiIdCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_selectedAppointment == null) {
      setState(() => _error = 'Select an appointment');
      return;
    }
    if (_mode != 'cash' && _transactionRefCtrl.text.trim().isEmpty) {
      setState(() => _error = 'Transaction reference is required for non-cash payments');
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
        if (_transactionRefCtrl.text.trim().isNotEmpty) 'transactionRef': _transactionRefCtrl.text.trim(),
        // COMPLETENESS ADD — mirrors web's CashPayment (StaffPages.jsx): a "UPI ID" field
        // that's always available regardless of payment method and gets saved alongside
        // the UTR/transaction reference above.
        if (_payerUpiIdCtrl.text.trim().isNotEmpty) 'payerUpiId': _payerUpiIdCtrl.text.trim(),
      });
      if (mounted) Navigator.of(context).pop(true);
    } catch (err) {
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
          if (_error != null) ...[ErrorBanner(error: _error!), const SizedBox(height: AppSpacing.md)],
          FutureBuilder<List<Appointment>>(
            future: _appointmentsFuture,
            builder: (context, snapshot) {
              if (snapshot.connectionState != ConnectionState.done) return const LoadingView();
              final appts = snapshot.data ?? [];
              if (appts.isEmpty) {
                return const Text('No appointments with pending payment right now.', style: TextStyle(color: AppColors.textSecondary));
              }
              return DropdownButtonFormField<Appointment>(
                value: _selectedAppointment,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Appointment (payment pending)'),
                items: appts
                    .map((a) => DropdownMenuItem(
                          value: a,
                          child: Text(
                            '${a.patient?.name ?? "Patient"} · ${a.appointmentDate} ${a.appointmentTime}',
                            overflow: TextOverflow.ellipsis,
                          ),
                        ))
                    .toList(),
                onChanged: (v) => setState(() => _selectedAppointment = v),
              );
            },
          ),
          // COMPLETENESS ADD — mirrors web's CashPayment "opens as soon as an appointment is
          // picked" paid/due summary. A receptionist only ever sees `fees.consultationFee`
          // (never totalAmount/GST breakdown), so this shows the same fee + a clear paid/due
          // line rather than numbers that would need the masked breakdown.
          if (_selectedAppointment != null) ...[
            const SizedBox(height: AppSpacing.md),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(AppSpacing.md),
              decoration: BoxDecoration(
                color: AppColors.background,
                borderRadius: BorderRadius.circular(AppRadius.button),
                border: Border.all(color: AppColors.border),
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
                        ? 'An advance has already been paid online for this appointment — you\'re collecting the remaining balance now.'
                        : 'Paid so far: ₹0 · Due now: ₹${_selectedAppointment!.fees.consultationFee?.toStringAsFixed(0) ?? 0}',
                    style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
                  ),
                ],
              ),
            ),
          ],
          const SizedBox(height: AppSpacing.md),
          DropdownButtonFormField<String>(
            value: _mode,
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
            decoration: const InputDecoration(labelText: 'UTR / Transaction number', hintText: 'Bank/UPI reference number'),
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(
            controller: _payerUpiIdCtrl,
            decoration: const InputDecoration(labelText: 'UPI ID', hintText: 'e.g. name@okhdfcbank'),
          ),
          const SizedBox(height: AppSpacing.lg),
          PrimaryButton(label: 'Record payment', onPressed: _submit, loading: _submitting),
        ],
      ),
    );
  }
}
