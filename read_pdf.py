import PyPDF2
import sys

pdf_path = r'c:\Users\Dave Lactuan\Downloads\PDF Template.pdf'
pdf = open(pdf_path, 'rb')
reader = PyPDF2.PdfReader(pdf)

print(f'Total Pages: {len(reader.pages)}')
print('=' * 80)

for i, page in enumerate(reader.pages):
    print(f'\n--- Page {i+1} ---')
    text = page.extract_text()
    print(text)
    print('=' * 80)

pdf.close()
