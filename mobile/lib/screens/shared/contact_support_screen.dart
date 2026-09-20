import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../state/auth_provider.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// COMPLETENESS FIX (audit Priority 3 #7 — mobile parity): `POST /contact` is a fully public,
/// no-auth endpoint (contact.validation.js — name/email/subject/message) already used by the web
/// public Contact page and by web's /delete-account page, and already has full admin-side
/// handling on mobile (admin_contact_screen.dart lists/responds to these) — but there was no way
/// to SUBMIT one from the mobile app itself, from any role. Prefills name/email from the signed-in
/// account since this screen is only reached from inside the app (Profile tab), unlike web's
/// logged-out public form.
class ContactSupportScreen extends StatefulWidget {
  const ContactSupportScreen({super.key});

  @override
  State<ContactSupportScreen> createState() => _ContactSupportScreenState();
}

class _ContactSupportScreenState extends State<ContactSupportScreen> {
  // Mirrors web's Contact form (client/src/pages/FeaturePages.jsx#PublicContent, kind: 'contact')
  // which uses a fixed subject dropdown rather than free text, defaulting to 'Appointment support'.
  static const _subjectOptions = [
    'Appointment support',
    'Doctor registration',
    'Payment or billing',
    'Technical issue',
    'Other',
  ];

  late final _nameController = TextEditingController(text: context.read<AuthProvider>().user?.name ?? '');
  late final _emailController = TextEditingController(text: context.read<AuthProvider>().user?.email ?? '');
  String _subject = _subjectOptions.first;
  final _messageController = TextEditingController();
  bool _submitting = false;
  bool _sent = false;
  String? _error;

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _messageController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_messageController.text.trim().isEmpty) {
      setState(() => _error = 'Please describe how we can help.');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await ApiClient.instance.post('/contact', body: {
        'name': _nameController.text.trim(),
        'email': _emailController.text.trim(),
        'subject': _subject,
        'message': _messageController.text.trim(),
      });
      if (mounted) setState(() => _sent = true);
    } catch (err) {
      if (mounted) {
        setState(() {
          _error = err.toString();
          _submitting = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Contact support')),
      body: ListView(
        padding: const EdgeInsets.all(AppSpacing.md),
        children: [
          // Mirrors web's public Contact page (PublicContent kind: 'contact' — FeaturePages.jsx):
          // kicker "We are here to help", h1 "Contact BookMyDoctor24", and its lede paragraph.
          const PageHeader(
            kicker: 'We are here to help',
            title: 'Contact BookMyDoctor24',
            subtitle: 'Get help with appointments, accounts, doctor onboarding, or clinic operations.',
          ),
          if (_sent)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: AppSpacing.lg),
              child: Column(
                children: [
                  const Icon(Icons.check_circle_outline, size: 48, color: AppColors.success),
                  const SizedBox(height: AppSpacing.md),
                  const Text(
                    'Your message has been sent. Our team will get back to you at the email you provided.',
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  OutlinedButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Back to profile')),
                ],
              ),
            )
          else ...[
            if (_error != null) ...[ErrorBanner(error: _error!), const SizedBox(height: AppSpacing.md)],
            TextField(controller: _nameController, decoration: const InputDecoration(labelText: 'Your name')),
            const SizedBox(height: AppSpacing.md),
            TextField(
              controller: _emailController,
              keyboardType: TextInputType.emailAddress,
              decoration: const InputDecoration(labelText: 'Your email'),
            ),
            const SizedBox(height: AppSpacing.md),
            DropdownButtonFormField<String>(
              initialValue: _subject,
              decoration: const InputDecoration(labelText: 'Subject'),
              items: [for (final s in _subjectOptions) DropdownMenuItem(value: s, child: Text(s))],
              onChanged: (v) => setState(() => _subject = v ?? _subjectOptions.first),
            ),
            const SizedBox(height: AppSpacing.md),
            TextField(
              controller: _messageController,
              decoration: const InputDecoration(labelText: 'How can we help?', alignLabelWithHint: true),
              maxLines: 6,
            ),
            const SizedBox(height: AppSpacing.lg),
            PrimaryButton(label: 'Send message', onPressed: _submit, loading: _submitting),
            const SizedBox(height: AppSpacing.lg),
            // Website's contact page also shows this static info panel ("Support that listens")
            // alongside the form — client/src/pages/FeaturePages.jsx#PublicContent's CONTACT_ROWS.
            SectionCard(
              title: 'Support that listens',
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: const [
                  Text('Send your query and our team will route it to the right specialist.', style: TextStyle(color: AppColors.textSecondary)),
                  SizedBox(height: AppSpacing.sm),
                  _ContactRow(label: 'Email', value: 'bookmydoctor24@gmail.com'),
                  _ContactRow(label: 'Support hours', value: 'Monday–Saturday, 9 AM–8 PM'),
                  _ContactRow(label: 'Service region', value: 'India'),
                  _ContactRow(
                    label: 'Urgent medical help',
                    value: 'Contact local emergency services. This platform is not an emergency helpline.',
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _ContactRow extends StatelessWidget {
  final String label;
  final String value;
  const _ContactRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(fontWeight: FontWeight.w600)),
          Text(value, style: const TextStyle(color: AppColors.textSecondary)),
        ],
      ),
    );
  }
}
