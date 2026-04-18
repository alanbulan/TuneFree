import 'package:flutter/material.dart';

class SearchHistorySection extends StatelessWidget {
  const SearchHistorySection({
    super.key,
    required this.history,
    required this.onSelect,
    required this.onClear,
    this.onClearRequested,
  });

  final List<String> history;
  final ValueChanged<String> onSelect;
  final VoidCallback onClear;
  final Future<bool> Function()? onClearRequested;

  @override
  Widget build(BuildContext context) {
    if (history.isEmpty) {
      return const SizedBox.shrink();
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text('搜索历史', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700)),
            IconButton(
              onPressed: () async {
                final shouldClear = await onClearRequested?.call() ?? true;
                if (shouldClear) {
                  onClear();
                }
              },
              icon: const Icon(Icons.delete_outline_rounded, size: 18),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: history.map((term) {
            return GestureDetector(
              onTap: () => onSelect(term),
              child: Container(
                constraints: const BoxConstraints(maxWidth: 150),
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: const Color(0xFFF0F1F5)),
                ),
                child: Text(
                  term,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 12, color: Color(0xFF666666)),
                ),
              ),
            );
          }).toList(growable: false),
        ),
      ],
    );
  }
}
