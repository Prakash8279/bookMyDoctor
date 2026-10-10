import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';
import '../auth/register_screen.dart';

/// Public doctor-and-clinic landing page. This is the mobile counterpart of
/// the website's `/for-doctors` page and keeps clinic onboarding available
/// before a user creates an account.
class ProviderLandingScreen extends StatefulWidget {
  const ProviderLandingScreen({super.key});

  @override
  State<ProviderLandingScreen> createState() => _ProviderLandingScreenState();
}

class _ProviderLandingScreenState extends State<ProviderLandingScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _clinicController = TextEditingController();
  final _phoneController = TextEditingController();
  final _cityController = TextEditingController();
  bool _submitting = false;
  bool _submitted = false;
  String? _error;

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _clinicController.dispose();
    _phoneController.dispose();
    _cityController.dispose();
    super.dispose();
  }

  void _registerClinic() {
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => const RegisterScreen(initialRole: 'doctor'),
    ));
  }

  Future<void> _requestDemo() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await ApiClient.instance.post('/contact', body: {
        'name': _nameController.text.trim(),
        'email': _emailController.text.trim(),
        'subject': 'Clinic demo request',
        'message': 'Clinic name: ${_clinicController.text.trim()}\n'
            'Phone: ${_phoneController.text.trim()}\n'
            'City: ${_cityController.text.trim()}',
      });
      if (mounted) setState(() => _submitted = true);
    } catch (error) {
      if (mounted) {
        setState(() => _error = error.toString());
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('For doctors & clinics')),
      body: ListView(
        padding: const EdgeInsets.all(AppSpacing.md),
        children: [
          Container(
            padding: const EdgeInsets.all(AppSpacing.lg),
            decoration: BoxDecoration(
              color: AppColors.charcoal,
              borderRadius: BorderRadius.circular(20),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                  decoration: BoxDecoration(
                    color: AppColors.gold.withValues(alpha: 0.18),
                    borderRadius: BorderRadius.circular(AppRadius.pill),
                  ),
                  child: const Text(
                    'FOR DOCTORS & CLINICS',
                    style: TextStyle(color: AppColors.gold, fontSize: 11, fontWeight: FontWeight.w800, letterSpacing: 0.6),
                  ),
                ),
                const SizedBox(height: AppSpacing.md),
                const Text(
                  'A calmer clinic, from arrival to consultation.',
                  style: TextStyle(color: Colors.white, fontSize: 27, height: 1.15, fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: AppSpacing.sm),
                const Text(
                  'Bring appointments, walk-ins, check-ins, live tokens, payments, staff, and daily reports into one simple clinic workflow.',
                  style: TextStyle(color: Color(0xFFD1CDCA), fontSize: 14, height: 1.5),
                ),
                const SizedBox(height: AppSpacing.lg),
                PrimaryButton(label: 'Register your clinic', onPressed: _registerClinic, icon: Icons.arrow_forward),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          const _ClinicSnapshot(),
          const SizedBox(height: AppSpacing.lg),
          const PageHeader(
            kicker: 'One operating view',
            title: 'Tools your team can use from day one.',
          ),
          const _FeatureCard(
            number: '01',
            icon: Icons.people_alt_outlined,
            title: 'Live queue control',
            detail: 'Call next, skip, pause, and keep patient tokens current.',
          ),
          const SizedBox(height: AppSpacing.sm),
          const _FeatureCard(
            number: '02',
            icon: Icons.how_to_reg_outlined,
            title: 'Walk-ins and check-in',
            detail: 'Register arrivals quickly from the reception desk.',
          ),
          const SizedBox(height: AppSpacing.sm),
          const _FeatureCard(
            number: '03',
            icon: Icons.receipt_long_outlined,
            title: 'Payments and receipts',
            detail: 'Support cash and UPI with clear daily collection visibility.',
          ),
          const SizedBox(height: AppSpacing.sm),
          const _FeatureCard(
            number: '04',
            icon: Icons.business_outlined,
            title: 'Team and branch setup',
            detail: 'Manage schedules, fees, staff access, and multiple clinics.',
          ),
          const SizedBox(height: AppSpacing.xl),
          const PageHeader(
            kicker: 'Simple onboarding',
            title: 'Go live in three clear steps.',
            subtitle: 'Create your clinic profile, configure operations, then complete verification.',
          ),
          const _StepRow(number: '01', title: 'Create your clinic profile', detail: 'Add clinic details, branches, working hours, and doctors.'),
          const _StepRow(number: '02', title: 'Configure daily operations', detail: 'Set fees, payment methods, queue rules, and team access.'),
          const _StepRow(number: '03', title: 'Verify and welcome patients', detail: 'Complete verification and start receiving bookings and walk-ins.'),
          const SizedBox(height: AppSpacing.xl),
          const PageHeader(
            kicker: 'Clinic demo',
            title: 'See BookADoctors in your clinic flow.',
            subtitle: 'Tell us about your practice and our team will get in touch.',
          ),
          if (_submitted)
            const SectionCard(
              child: Column(
                children: [
                  Icon(Icons.check_circle_outline, color: AppColors.success, size: 48),
                  SizedBox(height: AppSpacing.sm),
                  Text('Thanks—your demo request has been received.', textAlign: TextAlign.center, style: TextStyle(fontWeight: FontWeight.w700)),
                  SizedBox(height: AppSpacing.xs),
                  Text('Our team will contact you at the email you provided.', textAlign: TextAlign.center, style: TextStyle(color: AppColors.textSecondary)),
                ],
              ),
            )
          else
            Form(
              key: _formKey,
              child: SectionCard(
                child: Column(
                  children: [
                    if (_error != null) ...[ErrorBanner(error: _error!), const SizedBox(height: AppSpacing.md)],
                    TextFormField(
                      controller: _nameController,
                      textCapitalization: TextCapitalization.words,
                      decoration: const InputDecoration(labelText: 'Your name'),
                      validator: (value) => value == null || value.trim().isEmpty ? 'Enter your name.' : null,
                    ),
                    const SizedBox(height: AppSpacing.md),
                    TextFormField(
                      controller: _emailController,
                      keyboardType: TextInputType.emailAddress,
                      decoration: const InputDecoration(labelText: 'Email address'),
                      validator: (value) {
                        final email = value?.trim() ?? '';
                        return RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(email) ? null : 'Enter a valid email address.';
                      },
                    ),
                    const SizedBox(height: AppSpacing.md),
                    TextFormField(
                      controller: _clinicController,
                      textCapitalization: TextCapitalization.words,
                      decoration: const InputDecoration(labelText: 'Clinic name'),
                      validator: (value) => value == null || value.trim().isEmpty ? 'Enter your clinic name.' : null,
                    ),
                    const SizedBox(height: AppSpacing.md),
                    TextFormField(
                      controller: _phoneController,
                      keyboardType: TextInputType.phone,
                      decoration: const InputDecoration(labelText: 'Phone number'),
                      validator: (value) => value == null || value.trim().isEmpty ? 'Enter your phone number.' : null,
                    ),
                    const SizedBox(height: AppSpacing.md),
                    TextFormField(
                      controller: _cityController,
                      textCapitalization: TextCapitalization.words,
                      decoration: const InputDecoration(labelText: 'City'),
                      validator: (value) => value == null || value.trim().isEmpty ? 'Enter your city.' : null,
                    ),
                    const SizedBox(height: AppSpacing.lg),
                    PrimaryButton(label: 'Request a demo', onPressed: _requestDemo, loading: _submitting),
                  ],
                ),
              ),
            ),
          const SizedBox(height: AppSpacing.lg),
        ],
      ),
    );
  }
}

class _ClinicSnapshot extends StatelessWidget {
  const _ClinicSnapshot();

  @override
  Widget build(BuildContext context) {
    return const SectionCard(
      title: 'Today’s clinic flow',
      child: Column(
        children: [
          Row(
            children: [
              Expanded(child: _Metric(label: 'Now serving', value: '15')),
              SizedBox(width: AppSpacing.sm),
              Expanded(child: _Metric(label: 'Waiting', value: '8')),
            ],
          ),
          SizedBox(height: AppSpacing.md),
          _SummaryRow(label: 'Walk-ins checked in', value: '12'),
          _SummaryRow(label: 'Payments received', value: '₹8,400'),
          _SummaryRow(label: 'Doctor status', value: 'On duty', highlight: true),
        ],
      ),
    );
  }
}

class _Metric extends StatelessWidget {
  final String label;
  final String value;
  const _Metric({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(color: AppColors.primaryLight, borderRadius: BorderRadius.circular(AppRadius.button)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
        const SizedBox(height: 2),
        Text(value, style: const TextStyle(color: AppColors.primaryDark, fontSize: 28, fontWeight: FontWeight.w800)),
      ]),
    );
  }
}

class _SummaryRow extends StatelessWidget {
  final String label;
  final String value;
  final bool highlight;
  const _SummaryRow({required this.label, required this.value, this.highlight = false});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(children: [
        Expanded(child: Text(label, style: const TextStyle(fontSize: 13))),
        Text(value, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: highlight ? AppColors.success : AppColors.textPrimary)),
      ]),
    );
  }
}

class _FeatureCard extends StatelessWidget {
  final String number;
  final IconData icon;
  final String title;
  final String detail;
  const _FeatureCard({required this.number, required this.icon, required this.title, required this.detail});

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Container(
          width: 42,
          height: 42,
          alignment: Alignment.center,
          decoration: BoxDecoration(color: AppColors.primaryLight, borderRadius: BorderRadius.circular(12)),
          child: Icon(icon, color: AppColors.primaryDark),
        ),
        const SizedBox(width: AppSpacing.md),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(number, style: const TextStyle(color: AppColors.primaryDark, fontWeight: FontWeight.w800, fontSize: 12)),
          const SizedBox(height: 2),
          Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
          const SizedBox(height: 3),
          Text(detail, style: const TextStyle(color: AppColors.textSecondary, fontSize: 13, height: 1.4)),
        ])),
      ]),
    );
  }
}

class _StepRow extends StatelessWidget {
  final String number;
  final String title;
  final String detail;
  const _StepRow({required this.number, required this.title, required this.detail});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: SectionCard(
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(number, style: const TextStyle(color: AppColors.primaryDark, fontSize: 22, fontWeight: FontWeight.w800)),
          const SizedBox(width: AppSpacing.md),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            const SizedBox(height: 3),
            Text(detail, style: const TextStyle(color: AppColors.textSecondary, fontSize: 13, height: 1.4)),
          ])),
        ]),
      ),
    );
  }
}
